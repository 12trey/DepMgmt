const express = require('express');
const controller = require('../controllers/configController');

const router = express.Router();

router.get('/', controller.get);
router.put('/', controller.update);
router.post('/browse-folder', controller.browseFolder);
router.post('/browse-file', controller.browseFile);
router.post('/open-in-vscode', controller.openInVscode);

module.exports = router;
