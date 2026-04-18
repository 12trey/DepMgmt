const express = require('express');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const router = express.Router();

// Run a short PowerShell script and return stdout/stderr.
// Uses -EncodedCommand to avoid any quoting issues on Windows.
function runPS(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true }
  );
}

// ── GET /api/psadt/status ──────────────────────────────────────────────────────
// Returns: { installed, version, modulePath, galleryTrusted, galleryAvailable }
router.get('/status', async (_req, res) => {
  try {
    const { stdout } = await runPS(`
$mod     = Get-Module -ListAvailable -Name PSAppDeployToolkit |
             Sort-Object Version -Descending |
             Select-Object -First 1
$gallery = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue
[PSCustomObject]@{
    installed        = [bool]$mod
    version          = if ($mod)     { $mod.Version.ToString() } else { $null }
    modulePath       = if ($mod)     { $mod.ModuleBase }          else { $null }
    galleryTrusted   = if ($gallery) { $gallery.InstallationPolicy -eq 'Trusted' } else { $false }
    galleryAvailable = [bool]$gallery
} | ConvertTo-Json -Compress
`);
    res.json(JSON.parse(stdout.trim()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/psadt/trust-gallery ─────────────────────────────────────────────
// Sets PSGallery installation policy to Trusted.
router.post('/trust-gallery', async (_req, res) => {
  try {
    await runPS(`Set-PSRepository -Name PSGallery -InstallationPolicy Trusted`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/psadt/install-module ────────────────────────────────────────────
// Streams Install-Module output via SSE.
// Client should listen for { type:'stdout'|'stderr'|'exit', line?, code?, ok? }
router.post('/install-module', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Redirect verbose/information streams (4>) to stdout so we can show progress.
  const script = `
$ProgressPreference = 'SilentlyContinue'
Install-Module -Name PSAppDeployToolkit -Scope CurrentUser -Force -AllowClobber 4>&1 |
  ForEach-Object { Write-Output $_.ToString() }
Write-Output "Done."
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true }
  );

  proc.stdout.on('data', (d) =>
    d.toString().split('\n').filter(Boolean).forEach((l) => send({ type: 'stdout', line: l.trim() }))
  );
  proc.stderr.on('data', (d) =>
    d.toString().split('\n').filter(Boolean).forEach((l) => send({ type: 'stderr', line: l.trim() }))
  );
  proc.on('close', (code) => {
    send({ type: 'exit', code, ok: code === 0 });
    res.end();
  });
  proc.on('error', (err) => {
    send({ type: 'exit', code: -1, ok: false, error: err.message });
    res.end();
  });
});

module.exports = router;
