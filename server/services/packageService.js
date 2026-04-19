const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const Handlebars = require('handlebars');
const paths = require('../paths');

const execFileAsync = promisify(execFile);

function runPS(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true }
  );
}

// Locate the installed PSAppDeployToolkit module and copy it into destDir.
// Returns { ok, modulePath, fileCount } or { ok: false, reason } without throwing.
async function populateToolkitDir(destDir) {
  try {
    const { stdout } = await runPS(`
$userDocs = [Environment]::GetFolderPath('MyDocuments')
$ps5Path  = Join-Path $userDocs 'WindowsPowerShell\\Modules'
$ps7Path  = Join-Path $userDocs 'PowerShell\\Modules'
foreach ($p in @($ps5Path, $ps7Path)) {
    if ((Test-Path $p) -and ($env:PSModulePath -notlike "*$p*")) {
        $env:PSModulePath = $p + ';' + $env:PSModulePath
    }
}
$mod = Get-Module -ListAvailable -Name PSAppDeployToolkit |
         Sort-Object Version -Descending |
         Select-Object -First 1
if ($mod) { $mod.ModuleBase } else { '' }
`);
    const modulePath = stdout.trim();
    if (!modulePath) return { ok: false, reason: 'PSAppDeployToolkit module is not installed' };

    fs.mkdirSync(destDir, { recursive: true });
    for (const entry of fs.readdirSync(destDir)) {
      fs.rmSync(path.join(destDir, entry), { recursive: true, force: true });
    }
    fs.cpSync(modulePath, destDir, { recursive: true });

    return { ok: true, modulePath, fileCount: fs.readdirSync(destDir).length };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
exports.populateToolkitDir = populateToolkitDir;


// Convert a comma-separated string like "excel,winword" into a PS array literal @('excel', 'winword')
Handlebars.registerHelper('psArray', function (value) {
  if (!value) return '@()';
  const items = String(value).split(',').map((s) => `'${s.trim()}'`).join(', ');
  return `@(${items})`;
});

function readTemplate(psadtVersion, name) {
  const ver = psadtVersion === 'v4' ? 'v4' : 'v3';
  return fs.readFileSync(path.join(paths.templatesDir, ver, name), 'utf-8');
}

// Standard subdirectories created for each PSADT version
const V4_SUBDIRS = ['Assets', 'Config', 'Files', 'PSAppDeployToolkit', 'PSAppDeployToolkit.Extensions', 'Strings', 'SupportFiles'];
const V3_SUBDIRS = ['Files'];

// Allowed subfolders for generic file management (prevent path traversal)
const ALLOWED_FOLDERS = new Set(['Files', 'SupportFiles', 'Assets', 'PSAppDeployToolkit', 'PSAppDeployToolkit.Extensions']);
exports.ALLOWED_FOLDERS = ALLOWED_FOLDERS;

// File extensions that can be read/edited as text
const TEXT_EXTENSIONS = new Set(['.ps1', '.psm1', '.psd1', '.xml', '.json', '.ini', '.txt', '.bat', '.cmd', '.reg', '.yaml', '.yml', '.csv', '.md']);

// Starter content for the Extensions module
function makeExtPsd1(appName) {
  const guid = crypto.randomUUID();
  return `@{
    RootModule        = 'PSAppDeployToolkit.Extensions.psm1'
    ModuleVersion     = '1.0.0'
    GUID              = '${guid}'
    Author            = ''
    Description       = 'Custom PSAppDeployToolkit extensions for ${appName}'
    PowerShellVersion = '5.1'
    FunctionsToExport = @()
    CmdletsToExport   = @()
    VariablesToExport = @()
    AliasesToExport   = @()
}
`;
}

const EXT_PSM1 = `# PSAppDeployToolkit.Extensions.psm1
# Place your custom extension functions here.
# PSAppDeployToolkit automatically imports this module — no dot-sourcing required.

# Example:
# function Invoke-MyCustomAction {
#     [CmdletBinding()]
#     param()
#     Write-ADTLogEntry -Message 'Running custom action...'
# }
`;

function getTemplateSet(psadtVersion) {
  if (psadtVersion === 'v4') {
    return {
      script: { file: 'Invoke-AppDeployToolkit.ps1', template: 'Invoke-AppDeployToolkit.ps1.hbs', subdir: '' },
      config: { file: 'Config.psd1', template: 'Config.psd1.hbs', subdir: 'Config' },
    };
  }
  return {
    script: { file: 'Deploy-Application.ps1', template: 'Deploy-Application.ps1.hbs', subdir: '' },
    config: { file: 'AppDeployToolkitConfig.xml', template: 'AppDeployToolkitConfig.xml.hbs', subdir: '' },
  };
}

function generateScripts(dir, data) {
  const ver = data.psadtVersion || 'v3';
  const tpl = getTemplateSet(ver);

  const scriptDir = tpl.script.subdir ? path.join(dir, tpl.script.subdir) : dir;
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, tpl.script.file), Handlebars.compile(readTemplate(ver, tpl.script.template))(data));

  const configDir = tpl.config.subdir ? path.join(dir, tpl.config.subdir) : dir;
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, tpl.config.file), Handlebars.compile(readTemplate(ver, tpl.config.template))(data));
}

function parseExistingScript(dir, psadtVersion) {
  const scriptFile = psadtVersion === 'v4' ? 'Invoke-AppDeployToolkit.ps1' : 'Deploy-Application.ps1';
  const scriptPath = path.join(dir, scriptFile);
  if (!fs.existsSync(scriptPath)) return {};

  const content = fs.readFileSync(scriptPath, 'utf-8');
  const extract = (key) => {
    const m = content.match(new RegExp(String.raw`\b${key}\s*=\s*['"]([^'"]+)['"]`));
    return m ? m[1] : '';
  };

  const appName = extract('AppName');
  const version = extract('AppVersion');
  const vendor = extract('AppVendor');

  // Pull install command from between MARK: Install and the next MARK:
  let installCommand = '';
  const installSection = content.match(/##\s*MARK:\s*Install\b[\s\S]*?\n([\s\S]*?)(?:##\s*MARK:|$)/);
  if (installSection) {
    installCommand = installSection[1]
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('$adtSession'))
      .join('\n')
      .trim();
  }

  return { appName, version, vendor, installCommand };
}

exports.listAll = async () => {
  if (!fs.existsSync(paths.packagesDir)) return [];
  const apps = fs.readdirSync(paths.packagesDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const result = [];
  for (const app of apps) {
    const appDir = path.join(paths.packagesDir, app.name);
    const versions = fs.readdirSync(appDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const ver of versions) {
      const metaPath = path.join(appDir, ver.name, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        result.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8')));
      } else {
        result.push({ appName: app.name, version: ver.name });
      }
    }
  }
  return result;
};

exports.getApp = async (appName) => {
  const appDir = path.join(paths.packagesDir, appName);
  if (!fs.existsSync(appDir)) throw new Error('App not found');
  const versions = fs.readdirSync(appDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  return { appName, versions: versions.map((v) => v.name) };
};

// Regenerate scripts for a package from its saved metadata and the current templates
exports.regenerate = async (appName, version) => {
  const dir = path.join(paths.packagesDir, appName, version);
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) throw new Error('Package not found');
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  generateScripts(dir, metadata);
  return metadata;
};

exports.getVersion = async (appName, version) => {
  const metaPath = path.join(paths.packagesDir, appName, version, 'metadata.json');
  if (!fs.existsSync(metaPath)) throw new Error('Package not found');
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
};

exports.create = async (data) => {
  const { appName, version } = data;
  if (!appName || !version) throw new Error('appName and version are required');
  const dir = path.join(paths.packagesDir, appName, version);
  const subdirs = data.psadtVersion === 'v4' ? V4_SUBDIRS : V3_SUBDIRS;
  for (const sub of subdirs) fs.mkdirSync(path.join(dir, sub), { recursive: true });

  // Write extension stub files for v4 packages
  if (data.psadtVersion === 'v4') {
    const extDir = path.join(dir, 'PSAppDeployToolkit.Extensions');
    fs.writeFileSync(path.join(extDir, 'PSAppDeployToolkit.Extensions.psd1'), makeExtPsd1(appName), 'utf-8');
    fs.writeFileSync(path.join(extDir, 'PSAppDeployToolkit.Extensions.psm1'), EXT_PSM1, 'utf-8');
  }

  const metadata = { ...data, createdAt: new Date().toISOString(), status: 'draft' };
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  generateScripts(dir, metadata);

  // Auto-populate PSAppDeployToolkit folder for v4 packages if module is installed.
  // Failure is non-fatal — the user can populate manually from the package detail page.
  let toolkitPopulated = false;
  if (data.psadtVersion === 'v4') {
    const result = await populateToolkitDir(path.join(dir, 'PSAppDeployToolkit'));
    toolkitPopulated = result.ok;
  }

  return { ...metadata, toolkitPopulated };
};

exports.update = async (appName, version, data) => {
  const dir = path.join(paths.packagesDir, appName, version);
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) throw new Error('Package not found');

  const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const metadata = { ...existing, ...data, updatedAt: new Date().toISOString() };
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  generateScripts(dir, metadata);
  return metadata;
};

exports.getEntryScript = (appName, version) => {
  const dir = path.join(paths.packagesDir, appName, version);
  const metaPath = path.join(dir, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta.psadtVersion === 'v4') {
      return path.join(dir, 'Invoke-AppDeployToolkit.ps1');
    }
  }
  return path.join(dir, 'Deploy-Application.ps1');
};

exports.readEntryScript = async (appName, version) => {
  const scriptPath = exports.getEntryScript(appName, version);
  if (!fs.existsSync(scriptPath)) throw new Error('Entry script not found');
  return {
    filename: path.basename(scriptPath),
    content: fs.readFileSync(scriptPath, 'utf-8'),
  };
};

exports.saveEntryScript = async (appName, version, content) => {
  const scriptPath = exports.getEntryScript(appName, version);
  if (!fs.existsSync(scriptPath)) throw new Error('Entry script not found');
  fs.writeFileSync(scriptPath, content, 'utf-8');
};

exports.remove = async (appName, version) => {
  const dir = path.join(paths.packagesDir, appName, version);
  if (!fs.existsSync(dir)) throw new Error('Package not found');
  fs.rmSync(dir, { recursive: true, force: true });
  const appDir = path.join(paths.packagesDir, appName);
  if (fs.existsSync(appDir) && fs.readdirSync(appDir).length === 0) {
    fs.rmdirSync(appDir);
  }
};

exports.listFiles = async (appName, version) => {
  const filesDir = path.join(paths.packagesDir, appName, version, 'Files');
  if (!fs.existsSync(filesDir)) return [];
  return fs.readdirSync(filesDir);
};

exports.deleteFile = async (appName, version, filename) => {
  const filePath = path.join(paths.packagesDir, appName, version, 'Files', filename);
  if (!fs.existsSync(filePath)) throw new Error('File not found');
  fs.unlinkSync(filePath);
};

exports.checkMissingFiles = async (appName, version) => {
  const dir = path.join(paths.packagesDir, appName, version);
  const manifestPath = path.join(dir, 'files-manifest.json');
  if (!fs.existsSync(manifestPath)) return { hasManifest: false, missing: [], required: [] };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const filesDir = path.join(dir, 'Files');
  const actual = new Set(fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : []);
  const missing = manifest.files.filter(f => !actual.has(f.name));
  return { hasManifest: true, missing, required: manifest.files };
};

// ── Folder file management ─────────────────────────────────────────────────────

exports.listFolderFiles = async (appName, version, folder) => {
  if (!ALLOWED_FOLDERS.has(folder)) throw new Error('Invalid folder');
  const dir = path.join(paths.packagesDir, appName, version, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => fs.statSync(path.join(dir, f)).isFile())
    .map(f => ({
      name: f,
      size: fs.statSync(path.join(dir, f)).size,
      editable: TEXT_EXTENSIONS.has(path.extname(f).toLowerCase()),
    }));
};

exports.deleteFolderFile = async (appName, version, folder, filename) => {
  if (!ALLOWED_FOLDERS.has(folder)) throw new Error('Invalid folder');
  const filePath = path.join(paths.packagesDir, appName, version, folder, path.basename(filename));
  if (!fs.existsSync(filePath)) throw new Error('File not found');
  fs.unlinkSync(filePath);
};

exports.readFolderFile = async (appName, version, folder, filename) => {
  if (!ALLOWED_FOLDERS.has(folder)) throw new Error('Invalid folder');
  const filePath = path.join(paths.packagesDir, appName, version, folder, path.basename(filename));
  if (!fs.existsSync(filePath)) throw new Error('File not found');
  const ext = path.extname(filename).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) throw new Error('File is not text-editable');
  return fs.readFileSync(filePath, 'utf-8');
};

exports.saveFolderFile = async (appName, version, folder, filename, content) => {
  if (!ALLOWED_FOLDERS.has(folder)) throw new Error('Invalid folder');
  const dir = path.join(paths.packagesDir, appName, version, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, path.basename(filename)), content, 'utf-8');
};

exports.getFolderFilePath = (appName, version, folder, filename) => {
  if (!ALLOWED_FOLDERS.has(folder)) throw new Error('Invalid folder');
  const filePath = path.join(paths.packagesDir, appName, version, folder, path.basename(filename));
  if (!fs.existsSync(filePath)) throw new Error('File not found');
  return filePath;
};

const ASSET_README = `PSAppDeployToolkit Assets Folder
=================================
Place custom branding files here to override the default toolkit UI.
Leave this folder empty to use the toolkit defaults from PSAppDeployToolkit/Assets/.

Expected files
--------------
AppDeployToolkitLogo.png
  Logo shown in progress dialogs and notification balloons.
  Recommended: 400 x 100 px, PNG with transparency.

AppDeployToolkitBanner.png
  Banner image shown at the top of welcome and close dialogs.
  Recommended: 450 x 50 px, PNG with transparency.

AppDeployToolkitIcon.ico
  Window and taskbar icon for all toolkit dialogs.
  Recommended: Multi-size ICO (16 / 32 / 48 / 256 px).

Notes
-----
- Files here take precedence over PSAppDeployToolkit/Assets/ equivalents.
- Maintain the same file names — the toolkit loads assets by exact name.
- Keep image formats and dimensions consistent to avoid dialog layout issues.
`;

// Create the .psd1 / .psm1 extension stubs for an existing package that
// was created before stubs were added, or whose stubs were deleted.
exports.createExtensionStubs = async (appName, version) => {
  const dir = path.join(paths.packagesDir, appName, version, 'PSAppDeployToolkit.Extensions');
  fs.mkdirSync(dir, { recursive: true });

  const psd1Path = path.join(dir, 'PSAppDeployToolkit.Extensions.psd1');
  const psm1Path = path.join(dir, 'PSAppDeployToolkit.Extensions.psm1');
  const metaPath = path.join(paths.packagesDir, appName, version, 'metadata.json');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};

  const created = [];
  if (!fs.existsSync(psd1Path)) {
    fs.writeFileSync(psd1Path, makeExtPsd1(meta.appName || appName), 'utf-8');
    created.push('PSAppDeployToolkit.Extensions.psd1');
  }
  if (!fs.existsSync(psm1Path)) {
    fs.writeFileSync(psm1Path, EXT_PSM1, 'utf-8');
    created.push('PSAppDeployToolkit.Extensions.psm1');
  }
  return { created };
};

// Create an asset README for packages whose Assets folder is empty.
exports.createAssetReadme = async (appName, version) => {
  const dir = path.join(paths.packagesDir, appName, version, 'Assets');
  fs.mkdirSync(dir, { recursive: true });
  const readmePath = path.join(dir, '!README.txt');
  if (fs.existsSync(readmePath)) return { created: [] };
  fs.writeFileSync(readmePath, ASSET_README, 'utf-8');
  return { created: ['!README.txt'] };
};

exports.importFromPath = async (sourcePath) => {
  if (!fs.existsSync(sourcePath)) throw new Error('Path not found: ' + sourcePath);

  const isV4 = fs.existsSync(path.join(sourcePath, 'Invoke-AppDeployToolkit.ps1'));
  const isV3 = fs.existsSync(path.join(sourcePath, 'Deploy-Application.ps1'));
  if (!isV4 && !isV3) throw new Error('No PSADT entry script found (Invoke-AppDeployToolkit.ps1 or Deploy-Application.ps1).');

  const psadtVersion = isV4 ? 'v4' : 'v3';

  // Use existing metadata.json if present, otherwise parse from script
  const metaPath = path.join(sourcePath, 'metadata.json');
  const parsed = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    : parseExistingScript(sourcePath, psadtVersion);

  const appName = parsed.appName || path.basename(sourcePath);
  const version = parsed.version || '1.0';

  const destDir = path.join(paths.packagesDir, appName, version);
  if (fs.existsSync(destDir)) throw new Error(`Package ${appName} v${version} already exists.`);

  fs.cpSync(sourcePath, destDir, { recursive: true });

  // Ensure standard subdirs exist
  const subdirs = psadtVersion === 'v4' ? V4_SUBDIRS : V3_SUBDIRS;
  for (const sub of subdirs) fs.mkdirSync(path.join(destDir, sub), { recursive: true });

  const metadata = {
    ...parsed,
    appName,
    version,
    psadtVersion,
    importedAt: new Date().toISOString(),
    status: parsed.status || 'imported',
  };
  fs.writeFileSync(path.join(destDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  return metadata;
};
