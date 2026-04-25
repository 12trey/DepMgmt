const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const ALLOWED_VERSIONS = new Set(['v3', 'v4']);
const ALLOWED_FILES = new Set([
  'Invoke-AppDeployToolkit.ps1.hbs',
  'Config.psd1.hbs',
  'Deploy-Application.ps1.hbs',
  'AppDeployToolkitConfig.xml.hbs',
]);

function customPath(version, file) {
  return path.join(paths.customTemplatesDir, version, file);
}

function bundledPath(version, file) {
  return path.join(paths.templatesDir, version, file);
}

function validate(req, res) {
  const { version, file } = req.params;
  if (!ALLOWED_VERSIONS.has(version) || !ALLOWED_FILES.has(file)) {
    res.status(400).json({ error: 'Invalid template' });
    return null;
  }
  return { version, file };
}

exports.readTemplate = (req, res) => {
  const p = validate(req, res);
  if (!p) return;
  const { version, file } = p;
  const cp = customPath(version, file);
  const isCustom = fs.existsSync(cp);
  const readPath = isCustom ? cp : bundledPath(version, file);
  try {
    res.json({ content: fs.readFileSync(readPath, 'utf-8'), isCustom });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.saveTemplate = (req, res) => {
  const p = validate(req, res);
  if (!p) return;
  const { version, file } = p;
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  const savePath = customPath(version, file);
  try {
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, content, 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.resetTemplate = (req, res) => {
  const p = validate(req, res);
  if (!p) return;
  const { version, file } = p;
  const cp = customPath(version, file);
  try {
    if (fs.existsSync(cp)) fs.unlinkSync(cp);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
