const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const paths = require('../paths');

const pkgBase = paths.packagesDir;

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
const V4_SUBDIRS = ['Assets', 'Config', 'Files', 'PSAppDeployToolkit', 'Strings', 'SupportFiles'];
const V3_SUBDIRS = ['Files'];

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
  if (!fs.existsSync(pkgBase)) return [];
  const apps = fs.readdirSync(pkgBase, { withFileTypes: true }).filter((d) => d.isDirectory());
  const result = [];
  for (const app of apps) {
    const appDir = path.join(pkgBase, app.name);
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
  const appDir = path.join(pkgBase, appName);
  if (!fs.existsSync(appDir)) throw new Error('App not found');
  const versions = fs.readdirSync(appDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  return { appName, versions: versions.map((v) => v.name) };
};

// Regenerate scripts for a package from its saved metadata and the current templates
exports.regenerate = async (appName, version) => {
  const dir = path.join(pkgBase, appName, version);
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) throw new Error('Package not found');
  const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  generateScripts(dir, metadata);
  return metadata;
};

exports.getVersion = async (appName, version) => {
  const metaPath = path.join(pkgBase, appName, version, 'metadata.json');
  if (!fs.existsSync(metaPath)) throw new Error('Package not found');
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
};

exports.create = async (data) => {
  const { appName, version } = data;
  if (!appName || !version) throw new Error('appName and version are required');
  const dir = path.join(pkgBase, appName, version);
  const subdirs = data.psadtVersion === 'v4' ? V4_SUBDIRS : V3_SUBDIRS;
  for (const sub of subdirs) fs.mkdirSync(path.join(dir, sub), { recursive: true });

  const metadata = { ...data, createdAt: new Date().toISOString(), status: 'draft' };
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  generateScripts(dir, metadata);
  return metadata;
};

exports.update = async (appName, version, data) => {
  const dir = path.join(pkgBase, appName, version);
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) throw new Error('Package not found');

  const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const metadata = { ...existing, ...data, updatedAt: new Date().toISOString() };
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));

  generateScripts(dir, metadata);
  return metadata;
};

exports.getEntryScript = (appName, version) => {
  const dir = path.join(pkgBase, appName, version);
  const metaPath = path.join(dir, 'metadata.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta.psadtVersion === 'v4') {
      return path.join(dir, 'Invoke-AppDeployToolkit.ps1');
    }
  }
  return path.join(dir, 'Deploy-Application.ps1');
};

exports.remove = async (appName, version) => {
  const dir = path.join(pkgBase, appName, version);
  if (!fs.existsSync(dir)) throw new Error('Package not found');
  fs.rmSync(dir, { recursive: true, force: true });
  const appDir = path.join(pkgBase, appName);
  if (fs.existsSync(appDir) && fs.readdirSync(appDir).length === 0) {
    fs.rmdirSync(appDir);
  }
};

exports.listFiles = async (appName, version) => {
  const filesDir = path.join(pkgBase, appName, version, 'Files');
  if (!fs.existsSync(filesDir)) return [];
  return fs.readdirSync(filesDir);
};

exports.deleteFile = async (appName, version, filename) => {
  const filePath = path.join(pkgBase, appName, version, 'Files', filename);
  if (!fs.existsSync(filePath)) throw new Error('File not found');
  fs.unlinkSync(filePath);
};

exports.checkMissingFiles = async (appName, version) => {
  const dir = path.join(pkgBase, appName, version);
  const manifestPath = path.join(dir, 'files-manifest.json');
  if (!fs.existsSync(manifestPath)) return { hasManifest: false, missing: [], required: [] };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const filesDir = path.join(dir, 'Files');
  const actual = new Set(fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : []);
  const missing = manifest.files.filter(f => !actual.has(f.name));
  return { hasManifest: true, missing, required: manifest.files };
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

  const destDir = path.join(pkgBase, appName, version);
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
