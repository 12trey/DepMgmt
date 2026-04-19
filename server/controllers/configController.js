const fs = require('fs');
const { spawn } = require('child_process');
const paths = require('../paths');

exports.get = (_req, res) => {
  const config = JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
  res.json(config);
};

function stripQuotes(s) { return typeof s === 'string' ? s.replace(/^["']|["']$/g, '').trim() : s; }

exports.browseFolder = (req, res) => {
  const { initialPath = '' } = req.body || {};
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = "Select Folder"',
    '$d.ShowNewFolderButton = $true',
    initialPath ? `if (Test-Path '${initialPath.replace(/'/g, "''")}') { $d.SelectedPath = '${initialPath.replace(/'/g, "''")}' }` : '',
    'if ($d.ShowDialog() -eq "OK") { $d.SelectedPath } else { "" }',
  ].filter(Boolean).join('; ');

  const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  let out = '';
  let err = '';
  proc.stdout.on('data', (d) => { out += d.toString(); });
  proc.stderr.on('data', (d) => { err += d.toString(); });
  proc.on('close', () => {
    const selectedPath = out.trim();
    if (selectedPath) {
      res.json({ path: selectedPath });
    } else {
      res.json({ path: null });
    }
  });
  proc.on('error', (e) => res.status(500).json({ error: e.message }));
};

exports.update = (req, res) => {
  const current = JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
  const body = req.body;
  // Strip accidental surrounding quotes from path fields
  if (body.packages?.basePath) body.packages.basePath = stripQuotes(body.packages.basePath);
  if (body.repository?.localPath) body.repository.localPath = stripQuotes(body.repository.localPath);
  const updated = { ...current, ...body };
  fs.writeFileSync(paths.configPath, JSON.stringify(updated, null, 2));
  res.json(updated);
};
