const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const packageService = require('../services/packageService');
const paths = require('../paths');

exports.list = async (_req, res) => {
  try {
    const packages = await packageService.listAll();
    res.json(packages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getApp = async (req, res) => {
  try {
    const app = await packageService.getApp(req.params.appName);
    res.json(app);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

exports.getVersion = async (req, res) => {
  try {
    const pkg = await packageService.getVersion(req.params.appName, req.params.version);
    res.json(pkg);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const result = await packageService.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const result = await packageService.update(req.params.appName, req.params.version, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await packageService.remove(req.params.appName, req.params.version);
    res.json({ message: 'Package deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.uploadFiles = async (req, res) => {
  res.json({ message: `${req.files.length} file(s) uploaded`, files: req.files.map((f) => f.originalname) });
};

exports.listFiles = async (req, res) => {
  try {
    const files = await packageService.listFiles(req.params.appName, req.params.version);
    res.json(files);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

exports.regenerate = async (req, res) => {
  try {
    const result = await packageService.regenerate(req.params.appName, req.params.version);
    res.json({ message: 'Scripts regenerated from current templates', metadata: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.deleteFile = async (req, res) => {
  try {
    await packageService.deleteFile(req.params.appName, req.params.version, req.params.filename);
    res.json({ message: 'File deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.download = async (req, res) => {
  const { appName, version } = req.params;
  const pkgDir = path.join(paths.packagesDir, appName, version);
  if (!fs.existsSync(pkgDir)) {
    return res.status(404).json({ error: 'Package not found' });
  }

  const zipName = `${appName}_${version}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => res.status(500).json({ error: err.message }));
  archive.pipe(res);
  archive.directory(pkgDir, `${appName}_${version}`);
  archive.finalize();
};
