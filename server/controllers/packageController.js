const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const packageService = require('../services/packageService');
const paths = require('../paths');

// Map common file extensions to MIME types for raw file serving
const MIME_MAP = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.bmp': 'image/bmp', '.webp': 'image/webp',
  '.ps1': 'text/plain', '.psm1': 'text/plain', '.psd1': 'text/plain',
  '.xml': 'text/xml', '.json': 'application/json', '.txt': 'text/plain',
};

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

exports.checkFiles = async (req, res) => {
  try {
    const result = await packageService.checkMissingFiles(req.params.appName, req.params.version);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.importFromPath = async (req, res) => {
  try {
    const { sourcePath } = req.body;
    if (!sourcePath) return res.status(400).json({ error: 'sourcePath is required' });
    const result = await packageService.importFromPath(sourcePath);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ── Stub / scaffold creation ───────────────────────────────────────────────────

exports.createExtensionStubs = async (req, res) => {
  try {
    const { appName, version } = req.params;
    const result = await packageService.createExtensionStubs(appName, version);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createAssetReadme = async (req, res) => {
  try {
    const { appName, version } = req.params;
    const result = await packageService.createAssetReadme(appName, version);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.copyDefaultFiles = async (req, res) => {
  try {
    const { appName, version } = req.params;
    const { folder } = req.body || {};
    const result = await packageService.copyDefaultFiles(appName, version, folder ? [folder] : null);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Toolkit population ─────────────────────────────────────────────────────────

exports.populateToolkit = async (req, res) => {
  const { appName, version } = req.params;
  const destDir = path.join(paths.packagesDir, appName, version, 'PSAppDeployToolkit');
  try {
    const result = await packageService.populateToolkitDir(destDir);
    if (!result.ok) return res.status(400).json({ error: result.reason });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Folder file management ─────────────────────────────────────────────────────

exports.listFolderFiles = async (req, res) => {
  try {
    const { appName, version, folder } = req.params;
    const files = await packageService.listFolderFiles(appName, version, folder);
    res.json(files);
  } catch (err) {
    res.status(err.message === 'Invalid folder' ? 400 : 404).json({ error: err.message });
  }
};

exports.uploadFolderFiles = async (req, res) => {
  res.json({ message: `${req.files.length} file(s) uploaded`, files: req.files.map(f => f.originalname) });
};

exports.deleteFolderFile = async (req, res) => {
  try {
    const { appName, version, folder, filename } = req.params;
    await packageService.deleteFolderFile(appName, version, folder, filename);
    res.json({ message: 'File deleted' });
  } catch (err) {
    res.status(err.message === 'Invalid folder' ? 400 : 404).json({ error: err.message });
  }
};

exports.readEntryScript = async (req, res) => {
  try {
    const { appName, version } = req.params;
    const result = await packageService.readEntryScript(appName, version);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

exports.saveEntryScript = async (req, res) => {
  try {
    const { appName, version } = req.params;
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    await packageService.saveEntryScript(appName, version, content);
    res.json({ message: 'Entry script saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.readFolderFile = async (req, res) => {
  try {
    const { appName, version, folder, filename } = req.params;
    const content = await packageService.readFolderFile(appName, version, folder, filename);
    res.json({ content });
  } catch (err) {
    res.status(err.message === 'Invalid folder' ? 400 : 404).json({ error: err.message });
  }
};

exports.saveFolderFile = async (req, res) => {
  try {
    const { appName, version, folder, filename } = req.params;
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ error: 'content is required' });
    await packageService.saveFolderFile(appName, version, folder, filename, content);
    res.json({ message: 'File saved' });
  } catch (err) {
    res.status(err.message === 'Invalid folder' ? 400 : 500).json({ error: err.message });
  }
};

exports.serveFolderFile = async (req, res) => {
  try {
    const { appName, version, folder, filename } = req.params;
    const filePath = packageService.getFolderFilePath(appName, version, folder, filename);
    const ext = path.extname(filename).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
  } catch (err) {
    res.status(err.message === 'Invalid folder' ? 400 : 404).json({ error: err.message });
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
