const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const paths = require('../paths');

function getConfig() {
  return JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
}

function buildPSModulePath() {
  const userProfile = process.env.USERPROFILE || '';
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const standard = [
    ...(userProfile ? [
      path.join(userProfile, 'Documents', 'WindowsPowerShell', 'Modules'),
      path.join(userProfile, 'Documents', 'PowerShell', 'Modules'),
    ] : []),
    path.join(progFiles, 'WindowsPowerShell', 'Modules'),
    path.join(progFiles, 'PowerShell', 'Modules'),
    path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
  ];
  const base = (process.env.PSModulePath || '').split(';').filter(Boolean);
  return [...new Set([...standard, ...base])].join(';');
}

function spawnEnv() {
  return { ...process.env, PSModulePath: buildPSModulePath() };
}

// Validate that resolved path stays within the scripts root
exports.safePath = function safePath(scriptsRoot, rel) {
  if (!scriptsRoot) return null;
  const root = path.resolve(scriptsRoot);
  const resolved = path.resolve(path.join(scriptsRoot, rel || ''));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
};

exports.listScripts = function listScripts(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter(e => e.isDirectory() || e.name.endsWith('.ps1'))
    .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
};

exports.parseScript = function parseScript(scriptPath) {
  if (!fs.existsSync(scriptPath)) throw new Error('Script not found');
  const content = fs.readFileSync(scriptPath, 'utf8');
  const params = parseParams(content);
  const jsonPath = scriptPath.replace(/\.ps1$/i, '.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf8').replace(/,\s*([}\]])/g, '$1');
      const opts = JSON.parse(raw);
      params.forEach(p => {
        if (Array.isArray(opts[p.name]) && opts[p.name].length > 0) {
          p.comboOptions = opts[p.name].map(item => {
            if (typeof item !== 'object' || item === null) return { value: String(item), links: {} };
            const { value, ...links } = item;
            return { value: String(value ?? ''), links };
          });
        }
      });
    } catch { }
  }
  return {
    name: path.basename(scriptPath),
    description: parseDescription(content),
    params,
  };
};

function parseDescription(content) {
  const block = content.match(/^[\s]*<#([\s\S]*?)#>/);
  if (block) {
    const synopsis = block[1].match(/\.SYNOPSIS\s*\n(.*)/i);
    if (synopsis) return synopsis[1].trim();
    const first = block[1].split('\n').map(l => l.trim()).find(l => l && !l.startsWith('.'));
    if (first) return first;
  }
  const lines = content.match(/^(\s*#[^!].*\n)+/);
  if (lines) {
    const first = lines[0].split('\n').map(l => l.replace(/^\s*#\s?/, '').trim()).find(l => l);
    if (first) return first;
  }
  return '';
}

function parseParams(content) {
  const blockMatch = content.match(/\bparam\s*\(([\s\S]*?)\)(?=\s*(\n|#|$|\[|[a-z]))/i);
  if (!blockMatch) return [];
  const block = blockMatch[1];
  const params = [];
  const re = /((?:\[[^\]]*\]\s*)*)\$(\w+)(?:\s*=\s*([^,\n\)]+))?/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const attrs = m[1] || '';
    const name = m[2];
    const defaultRaw = m[3] ? m[3].trim() : undefined;
    const options = extractValidateSet(attrs);
    const type = options.length > 0 ? 'select' : inferType(attrs, defaultRaw, name);
    const mandatory = /Mandatory\s*=\s*\$true/i.test(attrs) ||
      (/\[Parameter[^\]]*Mandatory[^\]]*\]/i.test(attrs) && !/Mandatory\s*=\s*\$false/i.test(attrs));
    params.push({
      name,
      type,
      mandatory,
      default: cleanDefault(defaultRaw, type),
      help: extractHelpMessage(attrs),
      options,
    });
  }
  return params;
}

function inferType(attrs, defaultRaw, name) {
  if (/\[switch\]/i.test(attrs)) return 'switch';
  if (/\[bool\]/i.test(attrs)) return 'bool';
  if (/\[int(32|64)?\]/i.test(attrs)) return 'int';
  if (/\[double\]|\[float\]/i.test(attrs)) return 'float';
  if (/\[datetime\]/i.test(attrs)) return 'datetime';
  if (/\[string/i.test(attrs)) return 'string';
  if (defaultRaw !== undefined) {
    if (/^\$(true|false)$/i.test(defaultRaw)) return 'bool';
    if (/^-?\d+$/.test(defaultRaw)) return 'int';
    if (/^-?\d+\.\d+$/.test(defaultRaw)) return 'float';
  }
  if (/password|secret|key|token/i.test(name)) return 'password';
  return 'string';
}

function cleanDefault(raw, type) {
  if (raw === undefined) return undefined;
  raw = raw.trim().replace(/^['"]|['"]$/g, '');
  if (type === 'bool') return /^\$?true$/i.test(raw);
  if (type === 'switch') return false;
  return raw.replace(/^\$/, '');
}

function extractHelpMessage(attrs) {
  const m = attrs.match(/HelpMessage\s*=\s*['"]([^'"]+)['"]/i);
  return m ? m[1] : '';
}

function extractValidateSet(attrs) {
  const m = attrs.match(/ValidateSet\s*\(([^)]+)\)/i);
  if (!m) return [];
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
}

// Check if Microsoft.Graph module is installed
exports.checkMgGraphInstalled = function () {
  return new Promise((resolve) => {
    const config = getConfig();
    const ps = config.execution?.powershellPath || 'powershell.exe';
    const proc = spawn(ps, [
      '-NoProfile', '-NonInteractive', '-Command',
      '$m = Get-Module -ListAvailable -Name Microsoft.Graph.Authentication | Sort-Object Version -Descending | Select-Object -First 1; if ($m) { "installed:" + $m.Version } else { "not-installed" }',
    ], { env: spawnEnv(), windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => {
      const t = out.trim();
      resolve(t.startsWith('installed:')
        ? { installed: true, version: t.slice('installed:'.length) }
        : { installed: false, version: null });
    });
    proc.on('error', () => resolve({ installed: false, version: null }));
  });
};

// Stream Microsoft.Graph module installation via SSE
exports.installMgGraph = function (res) {
  const config = getConfig();
  const ps = config.execution?.powershellPath || 'powershell.exe';
  sseHeaders(res);
  const send = makeSend(res);
  const script = [
    '$ProgressPreference = "SilentlyContinue"',
    'Write-Host "Checking PSGallery trust..."',
    'if ((Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue).InstallationPolicy -ne "Trusted") {',
    '  Set-PSRepository -Name PSGallery -InstallationPolicy Trusted',
    '  Write-Host "PSGallery set to Trusted."',
    '}',
    'Write-Host "Installing Microsoft.Graph (Scope: CurrentUser) — this may take a few minutes..."',
    'Install-Module -Name Microsoft.Graph -Scope CurrentUser -Force -AllowClobber 4>&1 | ForEach-Object { Write-Host $_ }',
    'Write-Host "Done."',
  ].join('; ');
  const proc = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: spawnEnv(), windowsHide: true,
  });
  proc.stdout.on('data', c => send('stdout', c.toString()));
  proc.stderr.on('data', c => send('stderr', c.toString()));
  proc.on('close', code => { send('exit', code); res.end(); });
  proc.on('error', err => { send('error', err.message); res.end(); });
  return proc;
};

// Stream Connect-MgGraph (opens browser for interactive auth) via SSE
exports.connectMgGraph = function (res) {
  const config = getConfig();
  const ps = config.execution?.powershellPath || 'powershell.exe';
  sseHeaders(res);
  const send = makeSend(res);
  send('stdout', 'Opening Microsoft login in your browser...\nPlease sign in when prompted.\n');
  const script = [
    'Import-Module Microsoft.Graph.Authentication -ErrorAction Stop',
    'Connect-MgGraph -Scopes "User.Read","Group.Read.All","Device.Read.All","Directory.Read.All" -NoWelcome',
    '$ctx = Get-MgContext',
    'if ($ctx) { Write-Host "Connected as: $($ctx.Account)" } else { Write-Host "Authentication may not have completed. Try again." }',
  ].join('; ');
  const proc = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: spawnEnv(),
    // Do NOT set windowsHide:true — the browser popup needs to appear
  });
  proc.stdout.on('data', c => send('stdout', c.toString()));
  proc.stderr.on('data', c => send('stderr', c.toString()));
  proc.on('close', code => { send('exit', code); res.end(); });
  proc.on('error', err => { send('error', err.message); res.end(); });
  return proc;
};

// Disconnect MgGraph (clear the current session token)
exports.disconnectMgGraph = function () {
  return new Promise((resolve) => {
    const config = getConfig();
    const ps = config.execution?.powershellPath || 'powershell.exe';
    const proc = spawn(ps, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      'try { Import-Module Microsoft.Graph.Authentication -ErrorAction Stop; Disconnect-MgGraph } catch {}',
    ], { env: spawnEnv(), windowsHide: true });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
};

// Check if Az.Accounts module is installed
exports.checkAzInstalled = function () {
  return new Promise((resolve) => {
    const config = getConfig();
    const ps = config.execution?.powershellPath || 'powershell.exe';
    const proc = spawn(ps, [
      '-NoProfile', '-NonInteractive', '-Command',
      '$m = Get-Module -ListAvailable -Name Az.Accounts | Sort-Object Version -Descending | Select-Object -First 1; if ($m) { "installed:" + $m.Version } else { "not-installed" }',
    ], { env: spawnEnv(), windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => {
      const t = out.trim();
      resolve(t.startsWith('installed:')
        ? { installed: true, version: t.slice('installed:'.length) }
        : { installed: false, version: null });
    });
    proc.on('error', () => resolve({ installed: false, version: null }));
  });
};

// Stream Az module installation via SSE
exports.installAz = function (res) {
  const config = getConfig();
  const ps = config.execution?.powershellPath || 'powershell.exe';
  sseHeaders(res);
  const send = makeSend(res);
  const script = [
    '$ProgressPreference = "SilentlyContinue"',
    'Write-Host "Checking PSGallery trust..."',
    'if ((Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue).InstallationPolicy -ne "Trusted") {',
    '  Set-PSRepository -Name PSGallery -InstallationPolicy Trusted',
    '  Write-Host "PSGallery set to Trusted."',
    '}',
    'Write-Host "Installing Az module (Scope: CurrentUser) — this may take several minutes..."',
    'Install-Module -Name Az -Scope CurrentUser -Force -AllowClobber 4>&1 | ForEach-Object { Write-Host $_ }',
    'Write-Host "Done."',
  ].join('; ');
  const proc = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: spawnEnv(), windowsHide: true,
  });
  proc.stdout.on('data', c => send('stdout', c.toString()));
  proc.stderr.on('data', c => send('stderr', c.toString()));
  proc.on('close', code => { send('exit', code); res.end(); });
  proc.on('error', err => { send('error', err.message); res.end(); });
  return proc;
};

function toBase64PS(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

// Connect to Azure via direct PS spawn with -AccountId triggering WAM/browser dialog
exports.connectAz = async function (accountId, subscriptionId, subscriptionName, res) {
  const config = getConfig();
  const ps = config.execution?.powershellPath || 'powershell.exe';
  sseHeaders(res);
  const send = makeSend(res);
  const psEsc = s => String(s).replace(/'/g, "''");

  const lines = [
    '$WarningPreference = "Continue"',
    'Import-Module Az.Accounts -ErrorAction Stop',
  ];

  const connectParts = ['Connect-AzAccount', '-ErrorAction Stop'];

  //connectParts.push(`-TenantId '637dae3a-8825-4b77-9fc0-f9e9fdf966b7'`);
  if (accountId && accountId.trim())
    connectParts.push(`-AccountId '${psEsc(accountId.trim())}'`);

  if (subscriptionId && subscriptionId.trim())
    connectParts.push(`-SubscriptionId '${psEsc(subscriptionId.trim())}'`);
  else if (subscriptionName && subscriptionName.trim())
    connectParts.push(`-Subscription '${psEsc(subscriptionName.trim())}'`);

  // 3>&1 captures warning stream (where Az emits prompts) into the output pipeline
  lines.push(`${connectParts.join(' ')} 4>&1 | ForEach-Object { Write-Output "$_" }`);

  // if (subscriptionId && subscriptionId.trim())
  //   lines.push(`Set-AzContext -SubscriptionId '${psEsc(subscriptionId.trim())}' -ErrorAction Stop`);
  // else if (subscriptionName && subscriptionName.trim())
  //   lines.push(`Set-AzContext -Subscription '${psEsc(subscriptionName.trim())}' -ErrorAction Stop`);

  lines.push(
    'while (-not (Get-AzContext)) { Start-Sleep -Seconds 1 }',
    '$_ctx = Get-AzContext',
    'if ($_ctx) { Write-Host "Connected as: $($_ctx.Account.Id) | Subscription: $($_ctx.Subscription.Name)" } else { Write-Host "Connected. Run Get-AzContext to verify." }',
    ''
  );

  const script = lines.join('; ');
  send('stdout', 'Connecting to Azure...\n');

  //var ENV = spawnEnv();
  //const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Direct spawn — same pattern as Connect-MgGraph which works correctly
  // const proc = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
  //   env: spawnEnv(),
  //   windowsHide: false,
  //   detached: false
  //   // No windowsHide — required for WAM/browser dialogs to appear
  // });

  // const proc = spawn('cmd.exe', ['/c', 'start', '', ps, '-NoProfile', '-Command', script], {
  //   windowsHide: false
  // });

  const encoded = toBase64PS(script);

  const proc = spawn('cmd.exe', [
    '/c',
    'start',
    '',
    ps,
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand',
    encoded
  ], {
    windowsHide: false
  });

  //await (6000);
  proc.stdout.on('data', c => send('stdout', c.toString()));
  proc.stderr.on('data', c => send('stderr', c.toString()));
  proc.on('close', code => {
    send('exit', code); res.end();
  });
  proc.on('error', err => {
    send('error', err.message);
    res.end();
  });
  return proc;
};

// Disconnect Az (clear current context)
exports.disconnectAz = function () {
  return new Promise((resolve) => {
    const config = getConfig();
    const ps = config.execution?.powershellPath || 'powershell.exe';
    const proc = spawn(ps, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      'try { Import-Module Az.Accounts -ErrorAction Stop; Disconnect-AzAccount -Confirm:$false } catch {}',
    ], { env: spawnEnv(), windowsHide: true });
    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
};

// Run a user script with params, streaming output via SSE
// Returns the child process so the caller can kill it on client disconnect.
exports.runScript = function (scriptPath, params, useMgGraph, useAz, res) {
  const config = getConfig();
  const ps = config.execution?.powershellPath || 'powershell.exe';
  sseHeaders(res);
  const send = makeSend(res);

  const psEsc = s => String(s).replace(/'/g, "''");

  const lines = [
    '$ErrorActionPreference = "Continue"',
    '$ProgressPreference = "SilentlyContinue"',
    '$InformationPreference = "Continue"',
    '$__params = @{}',
  ];

  for (const [name, value] of Object.entries(params || {})) {
    if (value === true || value === 'true' || value === '$true') {
      lines.push(`$__params['${psEsc(name)}'] = $true`);
    } else if (value === false || value === 'false' || value === '$false') {
      lines.push(`$__params['${psEsc(name)}'] = $false`);
    } else if (value !== '' && value !== null && value !== undefined) {
      lines.push(`$__params['${psEsc(name)}'] = '${psEsc(String(value))}'`);
    }
  }

  if (useAz) {
    lines.push(
      '$WarningPreference = "Continue"',
      'Import-Module Az.Accounts -ErrorAction Stop',
      '$__azCtx = Get-AzContext -ErrorAction SilentlyContinue',
      'if (-not $__azCtx) { Connect-AzAccount -UseDeviceAuthentication -ErrorAction Stop 3>&1 | ForEach-Object { Write-Output "$_" } }',
    );
  }

  if (useMgGraph) {
    lines.push(
      'Import-Module Microsoft.Graph.Authentication -ErrorAction Stop',
      'Connect-MgGraph -NoWelcome -ErrorAction Stop',
    );
  }

  lines.push(
    // Capture pipeline output via ForEach-Object so the loop runs in real-time.
    // Strings are echoed to console immediately; objects are silently collected.
    '$__capturedObjects = [System.Collections.Generic.List[object]]::new()',
    `& '${psEsc(scriptPath)}' @__params | ForEach-Object {`,
    '  $__capturedObjects.Add($_)',
    '  if ($_ -is [string]) { Write-Host $_ }',
    '}',
    "Write-Output '<<<STRUCTURED_RESULT_START>>>'",
    'try {',
    '  $__arr = $__capturedObjects.ToArray()',
    '  if ($__arr.Length -eq 0) {',
    '    Write-Output "null"',
    '  } else {',
    '    $__slice = if ($__arr.Length -gt 500) { $__arr[0..499] } else { $__arr }',
    '    $__slice | ConvertTo-Json -Depth 5 -Compress -WarningAction SilentlyContinue',
    '  }',
    '} catch { Write-Output """[Serialization Error: $($_.Exception.Message)]""" }',
    "Write-Output '<<<STRUCTURED_RESULT_END>>>'",
  );

  const script = lines.join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  const proc = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    cwd: path.dirname(scriptPath),
    env: spawnEnv(),
    windowsHide: true,
  });

  proc.stdout.on('data', c => { 
    let output = c.toString();
    send('stdout', output);
  });
  proc.stderr.on('data', c => { 
    let output = c.toString();
    send('stderr', output);
   });
  proc.on('close', code => { 
    send('exit', code); res.end();
   });
  proc.on('error', err => { 
    send('error', err.message); res.end();
  });

  return proc;
};

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function makeSend(res) {
  return (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
}
