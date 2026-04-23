const fs = require('fs');
const path = require('path');
const paths = require('../paths');
const svc = require('../services/scriptService');

function getScriptsRoot() {
  const config = JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
  return config.scripts?.folderPath || '';
}

exports.browse = (req, res) => {
  const scriptsRoot = getScriptsRoot();
  if (!scriptsRoot) {
    return res.status(400).json({ error: 'Scripts folder not configured. Set it in Settings.' });
  }
  const rel = req.query.path || '';
  const absDir = svc.safePath(scriptsRoot, rel);
  if (!absDir) return res.status(400).json({ error: 'Invalid path' });
  if (!fs.existsSync(absDir)) return res.status(404).json({ error: 'Directory not found' });

  try {
    res.json({
      items: svc.listScripts(absDir),
      currentPath: rel,
      scriptsRoot,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.parseScript = (req, res) => {
  const scriptsRoot = getScriptsRoot();
  const rel = req.query.path;
  if (!rel) return res.status(400).json({ error: 'path required' });
  const absPath = svc.safePath(scriptsRoot, rel);
  if (!absPath || !absPath.endsWith('.ps1')) return res.status(400).json({ error: 'Invalid script path' });

  try {
    res.json(svc.parseScript(absPath));
  } catch (err) {
    res.status(err.message === 'Script not found' ? 404 : 500).json({ error: err.message });
  }
};

exports.runScript = (req, res) => {
  const scriptsRoot = getScriptsRoot();
  const { path: rel, params, useMgGraph } = req.body;
  if (!rel) return res.status(400).json({ error: 'path required' });
  const absPath = svc.safePath(scriptsRoot, rel);
  if (!absPath || !absPath.endsWith('.ps1')) return res.status(400).json({ error: 'Invalid script path' });
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Script not found' });

  const proc = svc.runScript(absPath, params || {}, useMgGraph || false, res);
  res.on('close', () => { try { proc.kill(); } catch {} });
};

exports.mgGraphStatus = async (_req, res) => {
  try {
    res.json(await svc.checkMgGraphInstalled());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.mgGraphInstall = (req, res) => {
  const proc = svc.installMgGraph(res);
  req.on('close', () => { try { proc.kill(); } catch {} });
};

exports.mgGraphConnect = (req, res) => {
  const proc = svc.connectMgGraph(res);
  req.on('close', () => { try { proc.kill(); } catch {} });
};

exports.mgGraphDisconnect = async (_req, res) => {
  try {
    await svc.disconnectMgGraph();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
