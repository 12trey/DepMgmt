const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const controller = require('../controllers/packageController');

const paths = require('../paths');
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { appName, version } = req.params;
    const dir = path.join(paths.packagesDir, appName, version, 'Files');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

const { ALLOWED_FOLDERS } = require('../services/packageService');

const folderStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { appName, version, folder } = req.params;
    if (!ALLOWED_FOLDERS.has(folder)) return cb(new Error('Invalid folder'));
    const dir = path.join(pkgBase, appName, version, folder);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const folderUpload = multer({ storage: folderStorage });

const router = express.Router();

router.get('/', controller.list);
router.get('/:appName', controller.getApp);
router.get('/:appName/:version', controller.getVersion);
router.post('/', controller.create);
router.post('/import', controller.importFromPath);
router.put('/:appName/:version', controller.update);
router.delete('/:appName/:version', controller.remove);
router.post('/:appName/:version/upload', upload.array('files'), controller.uploadFiles);
router.get('/:appName/:version/files', controller.listFiles);
router.delete('/:appName/:version/files/:filename', controller.deleteFile);
router.post('/:appName/:version/regenerate', controller.regenerate);
router.post('/:appName/:version/populate-toolkit', controller.populateToolkit);
router.post('/:appName/:version/create-extension-stubs', controller.createExtensionStubs);
router.post('/:appName/:version/create-asset-readme', controller.createAssetReadme);
router.post('/:appName/:version/copy-default-files', controller.copyDefaultFiles);
router.get('/:appName/:version/check-files', controller.checkFiles);
router.get('/:appName/:version/download', controller.download);

// Entry script (root-level .ps1)
router.get('/:appName/:version/entry-script', controller.readEntryScript);
router.put('/:appName/:version/entry-script', controller.saveEntryScript);

// Folder file management (SupportFiles, Assets, PSAppDeployToolkit, PSAppDeployToolkit.Extensions)
router.get('/:appName/:version/folder/:folder', controller.listFolderFiles);
router.post('/:appName/:version/folder/:folder/upload', folderUpload.array('files'), controller.uploadFolderFiles);
router.get('/:appName/:version/folder/:folder/text/:filename', controller.readFolderFile);
router.put('/:appName/:version/folder/:folder/text/:filename', controller.saveFolderFile);
router.get('/:appName/:version/folder/:folder/raw/:filename', controller.serveFolderFile);
router.delete('/:appName/:version/folder/:folder/:filename', controller.deleteFolderFile);

module.exports = router;
