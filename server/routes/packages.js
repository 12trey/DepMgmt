const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const controller = require('../controllers/packageController');

const paths = require('../paths');
const pkgBase = paths.packagesDir;

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const { appName, version } = req.params;
    const dir = path.join(pkgBase, appName, version, 'Files');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage });

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
router.get('/:appName/:version/check-files', controller.checkFiles);
router.get('/:appName/:version/download', controller.download);

module.exports = router;
