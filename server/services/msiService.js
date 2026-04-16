const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { v4: uuidv4, v5: uuidv5 } = require('uuid');

// Fixed namespace for deterministic component GUIDs (stable across rebuilds)
// RFC 4122 URL namespace — guaranteed valid variant/version nibbles
const GUID_NS = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

const WIX3_CACHE = path.join(os.homedir(), '.aipsadt', 'wix3');
const WIX3_URL = 'https://github.com/wixtoolset/wix3/releases/download/wix314rtm/wix314-binaries.zip';

const WIX3_DIRS = [
  'C:\\Program Files (x86)\\WiX Toolset v3.14\\bin',
  'C:\\Program Files (x86)\\WiX Toolset v3.11\\bin',
  'C:\\Program Files (x86)\\WiX Toolset v3.10\\bin',
  'C:\\Program Files\\WiX Toolset v3.14\\bin',
  'C:\\Program Files\\WiX Toolset v3.11\\bin',
];

function q(exe) {
  return exe.includes(' ') ? `"${exe}"` : exe;
}

function probe(cmd, args) {
  return new Promise((resolve) => {
    execFile(q(cmd), args || [], { timeout: 5000, shell: true }, (err, stdout, stderr) => {
      if (err) { resolve(null); return; }
      const out = (stdout + stderr).trim();
      resolve(out || null);
    });
  });
}

async function detectWix() {
  // WiX v3 — candle/light in PATH
  const v3path = await probe('candle', []);
  if (v3path && v3path.toLowerCase().includes('toolset')) {
    return { type: 'v3', version: v3path.split('\n')[0].trim(), exe: { candle: 'candle', light: 'light' } };
  }

  // WiX v3 — well-known install locations
  for (const dir of WIX3_DIRS) {
    const candle = path.join(dir, 'candle.exe');
    const light = path.join(dir, 'light.exe');
    if (fs.existsSync(candle)) {
      const ver = await probe(candle, []);
      return { type: 'v3', version: (ver || '').split('\n')[0].trim(), exe: { candle, light } };
    }
  }

  // WiX v3 — previously auto-downloaded cache
  const cachedCandle = path.join(WIX3_CACHE, 'candle.exe');
  const cachedLight = path.join(WIX3_CACHE, 'light.exe');
  if (fs.existsSync(cachedCandle)) {
    const ver = await probe(cachedCandle, []);
    return {
      type: 'v3',
      version: ((ver || '').split('\n')[0].trim() || 'v3.14') + ' (cached)',
      exe: { candle: cachedCandle, light: cachedLight },
    };
  }

  return { type: null };
}

// ─── WiX ID / XML helpers ─────────────────────────────────────────────────────

function sid(str) {
  let s = String(str).replace(/-/g, '').replace(/[^A-Za-z0-9_.]/g, '_');
  if (/^[0-9]/.test(s)) s = '_' + s;
  return s.slice(0, 72);
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function wixHive(root) {
  return { HKLM: 'HKLM', HKCU: 'HKCU', HKCR: 'HKCR', HKU: 'HKU', HKCC: 'HKCC' }[root] || 'HKLM';
}

function wixRegType(type) {
  return { string: 'string', integer: 'integer', binary: 'binary', expandable: 'expandable', multiString: 'multiString' }[type] || 'string';
}

function buildDirMap(nodes) {
  const map = {};
  function walk(ns) {
    for (const n of ns) {
      if (n.type === 'dir') { map[n.id] = 'd_' + sid(n.id); walk(n.children || []); }
    }
  }
  walk(nodes);
  return map;
}

function flattenFiles(nodes, parentDirId, dirMap) {
  const files = [];
  for (const n of nodes) {
    if (n.type === 'file') {
      files.push({ id: n.id, name: n.name, fileRef: n.fileRef || n.id, wixDirId: parentDirId });
    } else if (n.type === 'dir') {
      const childId = dirMap[n.id] || ('d_' + sid(n.id));
      files.push(...flattenFiles(n.children || [], childId, dirMap));
    }
  }
  return files;
}

function genDirs(nodes, dirMap, indent) {
  const pad = '  '.repeat(indent);
  let xml = '';
  for (const n of nodes) {
    if (n.type !== 'dir') continue;
    const id = dirMap[n.id] || ('d_' + sid(n.id));
    xml += `${pad}<Directory Id="${id}" Name="${esc(n.name)}">\n`;
    xml += genDirs(n.children || [], dirMap, indent + 1);
    xml += `${pad}</Directory>\n`;
  }
  return xml;
}

function buildShortcutComponents(shortcuts, allFiles, manufacturer, productName, indent) {
  const pad = '  '.repeat(indent);
  let xml = '';
  const startMenuRemoveDone = { done: false };

  for (const sc of (shortcuts || [])) {
    const targetFile = allFiles.find(f => f.id === sc.targetFileId);
    const targetDirId = targetFile ? targetFile.wixDirId : 'INSTALLDIR';
    const targetExe = targetFile ? targetFile.name : '';
    const descAttr = sc.description ? ` Description="${esc(sc.description)}"` : '';
    const locations = sc.location === 'both' ? ['desktop', 'startmenu'] : [sc.location];

    for (const loc of locations) {
      const compId = sid(`comp_sc_${sc.id}_${loc}`);
      const scId = sid(`sc_${sc.id}_${loc}`);
      const scDir = loc === 'desktop' ? 'DesktopFolder' : 'StartMenuDir';

      xml += `${pad}<Component Id="${compId}" Directory="INSTALLDIR" Guid="*">\n`;
      xml += `${pad}  <Shortcut Id="${scId}" Directory="${scDir}" Name="${esc(sc.name)}"`;
      xml += ` Target="[${targetDirId}]${esc(targetExe)}" WorkingDirectory="${targetDirId}"${descAttr} Advertise="no" />\n`;
      if (loc === 'startmenu' && !startMenuRemoveDone.done) {
        xml += `${pad}  <RemoveFolder Id="rf_StartMenuDir" Directory="StartMenuDir" On="uninstall" />\n`;
        startMenuRemoveDone.done = true;
      }
      xml += `${pad}  <RegistryValue Root="HKCU" Key="Software\\${esc(manufacturer)}\\${esc(productName)}" Name="${scId}" Type="integer" Value="1" KeyPath="yes" />\n`;
      xml += `${pad}</Component>\n`;
    }
  }
  return xml;
}

function buildRegistryComponents(registryEntries, indent) {
  const pad = '  '.repeat(indent);
  let xml = '';
  for (const entry of (registryEntries || [])) {
    const compId = sid(`comp_reg_${entry.id}`);
    xml += `${pad}<Component Id="${compId}" Directory="INSTALLDIR" Guid="*">\n`;
    if (!entry.values || entry.values.length === 0) {
      xml += `${pad}  <RegistryValue Root="${wixHive(entry.root)}" Key="${esc(entry.key)}" Name="Installed" Type="integer" Value="1" KeyPath="yes" />\n`;
    } else {
      for (let i = 0; i < entry.values.length; i++) {
        const v = entry.values[i];
        const kp = i === 0 ? ' KeyPath="yes"' : '';
        xml += `${pad}  <RegistryValue Root="${wixHive(entry.root)}" Key="${esc(entry.key)}" Name="${esc(v.name)}" Type="${wixRegType(v.type)}" Value="${esc(v.value)}"${kp} />\n`;
      }
    }
    xml += `${pad}</Component>\n`;
  }
  return xml;
}

function generateWxs(meta, allFiles, dirMap) {
  const { productName, manufacturer, version, upgradeCode, platform, scope, installDirName, shortcuts, registryEntries } = meta;
  const arch = platform === 'x86' ? 'x86' : 'x64';
  const installScope = scope === 'perUser' ? 'perUser' : 'perMachine';
  const dirName = esc(installDirName || productName);
  const hasShortcuts = (shortcuts || []).length > 0;
  const perUser = scope === 'perUser';

  let fileComps = '';
  for (const f of allFiles) {
    const fileId = sid('file_' + f.id);
    const compId = sid('comp_' + f.id);
    // ICE38: per-user components must use HKCU registry as KeyPath, not a file.
    // Guid="*" is also disallowed when a component has both a file and a registry KeyPath.
    const guid = perUser ? uuidv5(compId, GUID_NS).toUpperCase() : '*';
    fileComps += `      <Component Id="${compId}" Guid="${guid}" Directory="${f.wixDirId}">\n`;
    fileComps += `        <File Id="${fileId}" Source="files/${f.fileRef}" Name="${esc(f.name)}"${perUser ? '' : ' KeyPath="yes"'} />\n`;
    if (perUser) {
      fileComps += `        <RegistryValue Root="HKCU" Key="Software\\${esc(manufacturer)}\\${esc(productName)}\\Components" Name="${fileId}" Type="integer" Value="1" KeyPath="yes" />\n`;
    }
    fileComps += `      </Component>\n`;
  }

  // ICE64: every user-profile directory needs a RemoveFolder entry
  let cleanupComp = '';
  if (perUser) {
    cleanupComp += `      <Component Id="comp_cleanup_dirs" Guid="*" Directory="INSTALLDIR">\n`;
    cleanupComp += `        <RemoveFolder Id="rf_INSTALLDIR" Directory="INSTALLDIR" On="uninstall" />\n`;
    cleanupComp += `        <RemoveFolder Id="rf_UserProgramsFolder" Directory="UserProgramsFolder" On="uninstall" />\n`;
    for (const wixId of Object.values(dirMap)) {
      cleanupComp += `        <RemoveFolder Id="rf_${wixId}" Directory="${wixId}" On="uninstall" />\n`;
    }
    cleanupComp += `        <RegistryValue Root="HKCU" Key="Software\\${esc(manufacturer)}\\${esc(productName)}" Name="Installed" Type="integer" Value="1" KeyPath="yes" />\n`;
    cleanupComp += `      </Component>\n`;
  }

  const scComps = buildShortcutComponents(shortcuts, allFiles, manufacturer, productName, 3);
  const regComps = buildRegistryComponents(registryEntries, 3);

  const shortcutDirs = hasShortcuts
    ? `      <Directory Id="DesktopFolder" />\n      <Directory Id="ProgramMenuFolder">\n        <Directory Id="StartMenuDir" Name="${esc(productName)}" />\n      </Directory>\n`
    : '';

  const installDirSection = perUser
    ? `      <Directory Id="LocalAppDataFolder">
        <Directory Id="UserProgramsFolder" Name="Programs">
          <Directory Id="INSTALLDIR" Name="${dirName}">
${genDirs(meta.fileTree.children || [], dirMap, 6)}          </Directory>
        </Directory>
      </Directory>`
    : `      <Directory Id="${platform === 'x86' ? 'ProgramFilesFolder' : 'ProgramFiles64Folder'}">
        <Directory Id="INSTALLDIR" Name="${dirName}">
${genDirs(meta.fileTree.children || [], dirMap, 5)}        </Directory>
      </Directory>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="${esc(productName)}" Language="1033" Version="${esc(version)}"
           Manufacturer="${esc(manufacturer)}" UpgradeCode="{${upgradeCode}}">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="${installScope}" Platform="${arch}" />

    <MajorUpgrade DowngradeErrorMessage="A newer version of [ProductName] is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <Directory Id="TARGETDIR" Name="SourceDir">
${installDirSection}
${shortcutDirs}    </Directory>

    <ComponentGroup Id="AllComponents">
${fileComps}${cleanupComp}${scComps}${regComps}    </ComponentGroup>

    <Feature Id="MainFeature" Title="${esc(productName)}" Level="1">
      <ComponentGroupRef Id="AllComponents" />
    </Feature>
  </Product>
</Wix>`;
}

// ─── Compiler helpers ─────────────────────────────────────────────────────────

function runExe(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(q(exe), args, { cwd, shell: true, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (err) reject(new Error(output || err.message));
      else resolve(output);
    });
  });
}

// Download a URL to dest, following redirects.
// res.resume() is required on redirect responses to drain the body and release the TCP connection.
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    function get(url) {
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume(); // drain body so connection is released before next request
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', reject);
      }).on('error', reject);
    }
    get(url);
  });
}

// Extract a zip using powershell.exe directly (shell:false avoids cmd.exe quoting issues)
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
       '-Command', `Expand-Archive -Force -Path "${zipPath}" -DestinationPath "${destDir}"`],
      { shell: false, windowsHide: true, maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('\n').trim();
        if (err) reject(new Error(`Extraction failed: ${output || err.message}`));
        else resolve();
      }
    );
  });
}

async function downloadWix3() {
  const zipPath = path.join(os.tmpdir(), 'wix314-binaries.zip');
  try {
    await downloadFile(WIX3_URL, zipPath);
    fs.mkdirSync(WIX3_CACHE, { recursive: true });
    await extractZip(zipPath, WIX3_CACHE);

    const candle = path.join(WIX3_CACHE, 'candle.exe');
    const light = path.join(WIX3_CACHE, 'light.exe');
    if (!fs.existsSync(candle)) throw new Error('Extraction finished but candle.exe not found in extracted files.');

    return { type: 'v3', version: 'v3.14 (downloaded)', exe: { candle, light } };
  } finally {
    try { fs.unlinkSync(zipPath); } catch {}
  }
}

// ─── Main build entry point ───────────────────────────────────────────────────

async function buildMsi(meta, fileBuffers) {
  let tool = await detectWix();
  if (!tool.type) {
    tool = await downloadWix3();
  }

  const buildDir = path.join(os.tmpdir(), 'msibuild_' + uuidv4());
  fs.mkdirSync(path.join(buildDir, 'files'), { recursive: true });

  try {
    for (const [fileRef, buffer] of Object.entries(fileBuffers)) {
      fs.writeFileSync(path.join(buildDir, 'files', fileRef), buffer);
    }

    const dirMap = buildDirMap(meta.fileTree.children || []);
    const allFiles = flattenFiles(meta.fileTree.children || [], 'INSTALLDIR', dirMap);
    const wxs = generateWxs(meta, allFiles, dirMap);

    fs.writeFileSync(path.join(buildDir, 'product.wxs'), wxs, 'utf-8');

    const safeName = meta.productName.replace(/[^A-Za-z0-9_-]/g, '_');
    const msiName = `${safeName}_${meta.version}.msi`;
    const msiPath = path.join(buildDir, msiName);
    const arch = meta.platform === 'x86' ? 'x86' : 'x64';

    let buildLog = '';
    buildLog += await runExe(tool.exe.candle, ['-arch', arch, '-out', 'product.wixobj', 'product.wxs'], buildDir);
    buildLog += '\n' + await runExe(tool.exe.light, ['-sice:ICE91', '-out', msiName, 'product.wixobj'], buildDir);

    if (!fs.existsSync(msiPath)) {
      throw new Error(`Compiler finished but MSI was not created.\n${buildLog}`);
    }

    return { msiPath, msiName, dir: buildDir };
  } catch (err) {
    fs.rmSync(buildDir, { recursive: true, force: true });
    throw err;
  }
}

module.exports = { detectWix, buildMsi };
