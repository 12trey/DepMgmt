const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');

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
  // WiX v5 — dotnet global tool 'wix'
  const v5 = await probe('wix', ['--version']);
  if (v5) return { type: 'v5', version: v5, exe: 'wix' };

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

  return { type: null };
}

// WiX requires IDs starting with letter/underscore, only [A-Za-z0-9_.]
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

// Build nodeId -> wixDirId map for all dir nodes
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

// Flatten all file nodes, each carrying its parent dir's WiX ID
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

// Recursively emit <Directory> elements for dir nodes
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

function buildShortcutComponents(shortcuts, allFiles, manufacturer, productName, indent, wixVersion) {
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
      const regName = `${scId}`;

      xml += `${pad}<Component Id="${compId}" Directory="INSTALLDIR" Guid="*">\n`;
      xml += `${pad}  <Shortcut Id="${scId}" Directory="${scDir}" Name="${esc(sc.name)}"`;
      xml += ` Target="[${targetDirId}]${esc(targetExe)}" WorkingDirectory="${targetDirId}"${descAttr}`;
      if (wixVersion === 'v3') xml += ` Advertise="no"`;
      xml += ` />\n`;
      // Only emit RemoveFolder for StartMenuDir once
      if (loc === 'startmenu' && !startMenuRemoveDone.done) {
        xml += `${pad}  <RemoveFolder Id="rf_StartMenuDir" Directory="StartMenuDir" On="uninstall" />\n`;
        startMenuRemoveDone.done = true;
      }
      xml += `${pad}  <RegistryValue Root="HKCU" Key="Software\\${esc(manufacturer)}\\${esc(productName)}" Name="${regName}" Type="integer" Value="1" KeyPath="yes" />\n`;
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
      // Sentinel value so the component has a KeyPath
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

function generateWxsV3(meta, allFiles, dirMap) {
  const { productName, manufacturer, version, upgradeCode, platform, scope, installDirName, shortcuts, registryEntries } = meta;
  const pf = platform === 'x86' ? 'ProgramFilesFolder' : 'ProgramFiles64Folder';
  const arch = platform === 'x86' ? 'x86' : 'x64';
  const installScope = scope === 'perUser' ? 'perUser' : 'perMachine';
  const dirName = esc(installDirName || productName);
  const hasShortcuts = (shortcuts || []).length > 0;

  let fileComps = '';
  for (const f of allFiles) {
    fileComps += `      <Component Id="${sid('comp_' + f.id)}" Guid="*" Directory="${f.wixDirId}">\n`;
    fileComps += `        <File Id="${sid('file_' + f.id)}" Source="files/${f.fileRef}" Name="${esc(f.name)}" KeyPath="yes" />\n`;
    fileComps += `      </Component>\n`;
  }

  const scComps = buildShortcutComponents(shortcuts, allFiles, manufacturer, productName, 3, 'v3');
  const regComps = buildRegistryComponents(registryEntries, 3);

  const shortcutDirs = hasShortcuts
    ? `      <Directory Id="DesktopFolder" />\n      <Directory Id="ProgramMenuFolder">\n        <Directory Id="StartMenuDir" Name="${esc(productName)}" />\n      </Directory>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*" Name="${esc(productName)}" Language="1033" Version="${esc(version)}"
           Manufacturer="${esc(manufacturer)}" UpgradeCode="{${upgradeCode}}">
    <Package InstallerVersion="500" Compressed="yes" InstallScope="${installScope}" Platform="${arch}" />

    <MajorUpgrade DowngradeErrorMessage="A newer version of [ProductName] is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="${pf}">
        <Directory Id="INSTALLDIR" Name="${dirName}">
${genDirs(meta.fileTree.children || [], dirMap, 5)}        </Directory>
      </Directory>
${shortcutDirs}    </Directory>

    <ComponentGroup Id="AllComponents">
${fileComps}${scComps}${regComps}    </ComponentGroup>

    <Feature Id="MainFeature" Title="${esc(productName)}" Level="1">
      <ComponentGroupRef Id="AllComponents" />
    </Feature>
  </Product>
</Wix>`;
}

function generateWxsV5(meta, allFiles, dirMap) {
  const { productName, manufacturer, version, upgradeCode, platform, scope, installDirName, shortcuts, registryEntries } = meta;
  const pf = platform === 'x86' ? 'ProgramFilesFolder' : 'ProgramFiles64Folder';
  const arch = platform === 'x86' ? 'x86' : 'x64';
  const pkgScope = scope === 'perUser' ? 'perUser' : 'perMachine';
  const dirName = esc(installDirName || productName);
  const hasShortcuts = (shortcuts || []).length > 0;

  let fileComps = '';
  for (const f of allFiles) {
    fileComps += `    <Component Id="${sid('comp_' + f.id)}" Directory="${f.wixDirId}" Guid="*">\n`;
    fileComps += `      <File Id="${sid('file_' + f.id)}" Source="files/${f.fileRef}" Name="${esc(f.name)}" KeyPath="yes" />\n`;
    fileComps += `    </Component>\n`;
  }

  const scComps = buildShortcutComponents(shortcuts, allFiles, manufacturer, productName, 2, 'v5');
  const regComps = buildRegistryComponents(registryEntries, 2);

  const shortcutDirs = hasShortcuts
    ? `  <StandardDirectory Id="DesktopFolder" />\n  <StandardDirectory Id="ProgramMenuFolder">\n    <Directory Id="StartMenuDir" Name="${esc(productName)}" />\n  </StandardDirectory>\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package Name="${esc(productName)}"
           Manufacturer="${esc(manufacturer)}"
           Version="${esc(version)}"
           UpgradeCode="{${upgradeCode}}"
           Scope="${pkgScope}"
           Platform="${arch}">

    <MajorUpgrade DowngradeErrorMessage="A newer version of [ProductName] is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <StandardDirectory Id="${pf}">
      <Directory Id="INSTALLDIR" Name="${dirName}">
${genDirs(meta.fileTree.children || [], dirMap, 4)}      </Directory>
    </StandardDirectory>
${shortcutDirs}
    <ComponentGroup Id="AllComponents">
${fileComps}${scComps}${regComps}    </ComponentGroup>

    <Feature Id="MainFeature" Level="1">
      <ComponentGroupRef Id="AllComponents" />
    </Feature>
  </Package>
</Wix>`;
}

function runExe(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(q(exe), args, { cwd, shell: true, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (err) reject(new Error(output || err.message));
      else resolve(output);
    });
  });
}

async function buildMsi(meta, fileBuffers) {
  const tool = await detectWix();
  if (!tool.type) {
    throw new Error(
      'No WiX toolset found on this machine.\n' +
      'Install WiX v5:  dotnet tool install --global wix\n' +
      'Install WiX v3:  https://wixtoolset.org/releases/'
    );
  }

  const buildDir = path.join(os.tmpdir(), 'msibuild_' + uuidv4());
  fs.mkdirSync(path.join(buildDir, 'files'), { recursive: true });

  try {
    // Write each uploaded file buffer to buildDir/files/<fileRef>
    for (const [fileRef, buffer] of Object.entries(fileBuffers)) {
      fs.writeFileSync(path.join(buildDir, 'files', fileRef), buffer);
    }

    const dirMap = buildDirMap(meta.fileTree.children || []);
    const allFiles = flattenFiles(meta.fileTree.children || [], 'INSTALLDIR', dirMap);

    const wxs = tool.type === 'v5'
      ? generateWxsV5(meta, allFiles, dirMap)
      : generateWxsV3(meta, allFiles, dirMap);

    fs.writeFileSync(path.join(buildDir, 'product.wxs'), wxs, 'utf-8');

    const safeName = meta.productName.replace(/[^A-Za-z0-9_-]/g, '_');
    const msiName = `${safeName}_${meta.version}.msi`;
    const msiPath = path.join(buildDir, msiName);

    let buildLog = '';
    if (tool.type === 'v5') {
      buildLog = await runExe(tool.exe, ['build', 'product.wxs', '-o', msiName], buildDir);
    } else {
      const arch = meta.platform === 'x86' ? 'x86' : 'x64';
      buildLog += await runExe(tool.exe.candle, ['-arch', arch, '-out', 'product.wixobj', 'product.wxs'], buildDir);
      buildLog += '\n' + await runExe(tool.exe.light, ['-out', msiName, 'product.wixobj'], buildDir);
    }

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
