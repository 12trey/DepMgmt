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
      files.push({ id: n.id, name: n.name, fileRef: n.fileRef || n.id, wixDirId: parentDirId, service: n.service || null });
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

// destDirMaps: { [destId]: { [nodeId]: wixDirId } }
function generateWxs(meta, allFiles, destDirMaps) {
  const { productName, manufacturer, version, upgradeCode, platform, scope, installDirName, shortcuts, registryEntries, destinations } = meta;
  const arch = platform === 'x86' ? 'x86' : 'x64';
  const installScope = scope === 'perUser' ? 'perUser' : 'perMachine';
  const dirName = esc(installDirName || productName);
  const hasShortcuts = (shortcuts || []).length > 0;
  const perUser = scope === 'perUser';

  const installDirDest = (destinations || []).find(d => d.wixId === 'INSTALLDIR');
  const installDirDirMap = installDirDest ? (destDirMaps[installDirDest.id] || {}) : {};

  // ── File components ──────────────────────────────────────────────────────────
  let fileComps = '';
  for (const f of allFiles) {
    const fileId = sid('file_' + f.id);
    const compId = sid('comp_' + f.id);
    const needsHkcu = perUser && f.isInstallDir;
    const guid = needsHkcu ? uuidv5(compId, GUID_NS).toUpperCase() : '*';
    fileComps += `      <Component Id="${compId}" Guid="${guid}" Directory="${f.wixDirId}">\n`;
    fileComps += `        <File Id="${fileId}" Source="files/${f.fileRef}" Name="${esc(f.name)}"${needsHkcu ? '' : ' KeyPath="yes"'} />\n`;
    if (needsHkcu) {
      fileComps += `        <RegistryValue Root="HKCU" Key="Software\\${esc(manufacturer)}\\${esc(productName)}\\Components" Name="${fileId}" Type="integer" Value="1" KeyPath="yes" />\n`;
    }

    // Windows service installation
    if (f.service && f.service.name) {
      const svc = f.service;
      const svcInstId = sid('svcInst_' + f.id);
      const svcCtrlId = sid('svcCtrl_' + f.id);
      const startAttr = { auto: 'auto', demand: 'demand', disabled: 'disabled' }[svc.startType] || 'demand';
      const accountAttr = svc.account === 'LocalService'    ? 'NT AUTHORITY\\LocalService'
                        : svc.account === 'NetworkService'  ? 'NT AUTHORITY\\NetworkService'
                        : svc.account === 'custom'          ? esc(svc.customAccount || '')
                        : ''; // blank = LocalSystem (WiX default)

      fileComps += `        <ServiceInstall Id="${svcInstId}" Name="${esc(svc.name)}" DisplayName="${esc(svc.displayName || svc.name)}"`;
      fileComps += ` Type="ownProcess" Start="${startAttr}" ErrorControl="${svc.errorControl || 'normal'}"`;
      if (svc.description) fileComps += ` Description="${esc(svc.description)}"`;
      if (accountAttr) fileComps += ` Account="${accountAttr}"`;
      if (svc.account === 'custom' && svc.password) fileComps += ` Password="${esc(svc.password)}"`;
      fileComps += ` />\n`;

      const scParts = [];
      if (svc.startOnInstall !== false) scParts.push('Start="install"');
      const stopWhen = (svc.stopOnUninstall !== false) ? 'uninstall' : null;
      if (stopWhen) scParts.push(`Stop="${stopWhen}"`);
      if (svc.removeOnUninstall !== false) scParts.push('Remove="uninstall"');
      if (scParts.length) {
        fileComps += `        <ServiceControl Id="${svcCtrlId}" Name="${esc(svc.name)}" ${scParts.join(' ')} Wait="yes" />\n`;
      }
    }

    fileComps += `      </Component>\n`;
  }

  // ── Cleanup component (perUser ICE64) ────────────────────────────────────────
  let cleanupComp = '';
  if (perUser && installDirDest) {
    cleanupComp += `      <Component Id="comp_cleanup_dirs" Guid="*" Directory="INSTALLDIR">\n`;
    cleanupComp += `        <RemoveFolder Id="rf_INSTALLDIR" Directory="INSTALLDIR" On="uninstall" />\n`;
    cleanupComp += `        <RemoveFolder Id="rf_UserProgramsFolder" Directory="UserProgramsFolder" On="uninstall" />\n`;
    for (const wixId of Object.values(installDirDirMap)) {
      cleanupComp += `        <RemoveFolder Id="rf_${wixId}" Directory="${wixId}" On="uninstall" />\n`;
    }
    cleanupComp += `        <RegistryValue Root="HKCU" Key="Software\\${esc(manufacturer)}\\${esc(productName)}" Name="Installed" Type="integer" Value="1" KeyPath="yes" />\n`;
    cleanupComp += `      </Component>\n`;
  }

  const scComps = buildShortcutComponents(shortcuts, allFiles, manufacturer, productName, 3);
  const regComps = buildRegistryComponents(registryEntries, 3);

  // ── Directory XML + SetProperty for custom paths ──────────────────────────────
  let directoryXml = '';
  let setProperties = '';

  for (const dest of (destinations || [])) {
    const destDirMap = destDirMaps[dest.id] || {};

    if (dest.wixId === 'INSTALLDIR') {
      if (perUser) {
        directoryXml += `      <Directory Id="LocalAppDataFolder">
        <Directory Id="UserProgramsFolder" Name="Programs">
          <Directory Id="INSTALLDIR" Name="${dirName}">
${genDirs(dest.children || [], destDirMap, 6)}          </Directory>
        </Directory>
      </Directory>\n`;
      } else {
        directoryXml += `      <Directory Id="${platform === 'x86' ? 'ProgramFilesFolder' : 'ProgramFiles64Folder'}">
        <Directory Id="INSTALLDIR" Name="${dirName}">
${genDirs(dest.children || [], destDirMap, 5)}        </Directory>
      </Directory>\n`;
      }
    } else if (dest.customPath) {
      // Custom absolute path — SetProperty sets directory to the full path at install time
      setProperties += `    <SetProperty Id="${dest.wixId}" Value="${esc(dest.customPath)}" Sequence="both" Before="CostFinalize" />\n`;
      directoryXml += `      <Directory Id="${dest.wixId}" Name=".">\n`;
      directoryXml += genDirs(dest.children || [], destDirMap, 4);
      directoryXml += `      </Directory>\n`;
    } else {
      // Predefined WiX directory ID (CommonAppDataFolder, WindowsFolder, etc.)
      directoryXml += `      <Directory Id="${dest.wixId}">\n`;
      directoryXml += genDirs(dest.children || [], destDirMap, 4);
      directoryXml += `      </Directory>\n`;
    }
  }

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
${setProperties ? '\n' + setProperties : ''}
    <Directory Id="TARGETDIR" Name="SourceDir">
${directoryXml}${shortcutDirs}    </Directory>

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

// ─── MSI property probe ───────────────────────────────────────────────────────

function probeMsi(buffer) {
  const tmpMsi = path.join(os.tmpdir(), `probe_${uuidv4()}.msi`);
  const tmpScript = path.join(os.tmpdir(), `probe_${uuidv4()}.ps1`);

  fs.writeFileSync(tmpMsi, buffer);
  const escapedPath = tmpMsi.replace(/'/g, "''");
  // Windows Installer SQL does not support IN (...) — query all and filter in PowerShell
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$installer = New-Object -ComObject WindowsInstaller.Installer",
    `$db = $installer.OpenDatabase('${escapedPath}', 0)`,
    '$view = $db.OpenView("SELECT Property, Value FROM Property")',
    '$view.Execute()',
    '$want = @("ProductName","Manufacturer","ProductVersion","UpgradeCode","ProductCode","Template")',
    '$result = @{}',
    'while ($true) {',
    '  $record = $view.Fetch()',
    '  if ($null -eq $record) { break }',
    '  $k = $record.StringData(1)',
    '  if ($want -contains $k) { $result[$k] = $record.StringData(2) }',
    '}',
    '$view.Close()',
    '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($db) | Out-Null',
    '[System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer) | Out-Null',
    '$result | ConvertTo-Json -Compress',
  ].join('\n');
  fs.writeFileSync(tmpScript, script, 'utf-8');

  // Cleanup inside the callback — NOT in a finally block.
  // An async function's finally runs when new Promise() is returned (synchronously),
  // which deletes the .ps1 before PowerShell can read it.
  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpScript],
      { shell: false, windowsHide: true, maxBuffer: 1 * 1024 * 1024 },
      (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpMsi); } catch {}
        try { fs.unlinkSync(tmpScript); } catch {}
        if (err) return reject(new Error((stderr || '').trim() || err.message));
        try {
          const data = JSON.parse(stdout.trim());
          const template = (data.Template || '').toLowerCase();
          const platform = (template.startsWith('intel') && !template.includes('64')) ? 'x86' : 'x64';
          const stripBraces = s => (s || '').replace(/[{}]/g, '').toUpperCase();
          resolve({
            productName: data.ProductName || '',
            manufacturer: data.Manufacturer || '',
            version: data.ProductVersion || '',
            upgradeCode: stripBraces(data.UpgradeCode),
            platform,
          });
        } catch (e) {
          reject(new Error('Failed to parse MSI properties: ' + e.message + '\nOutput: ' + stdout.slice(0, 500)));
        }
      }
    );
  });
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

    // Support both new destinations[] format and legacy fileTree format
    const destinations = meta.destinations || [
      { id: 'ROOT', wixId: 'INSTALLDIR', children: (meta.fileTree || {}).children || [] },
    ];

    const destDirMaps = {};
    const allFiles = [];
    for (const dest of destinations) {
      const destDirMap = buildDirMap(dest.children || []);
      destDirMaps[dest.id] = destDirMap;
      const destFiles = flattenFiles(dest.children || [], dest.wixId, destDirMap)
        .map(f => ({ ...f, isInstallDir: dest.wixId === 'INSTALLDIR' }));
      allFiles.push(...destFiles);
    }

    const wxs = generateWxs({ ...meta, destinations }, allFiles, destDirMaps);

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

module.exports = { detectWix, probeMsi, buildMsi };
