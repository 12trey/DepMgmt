const express = require('express');
const controller = require('../controllers/configController');

const router = express.Router();

router.get('/', controller.get);
router.put('/', controller.update);
router.post('/browse-folder', controller.browseFolder);
router.post('/browse-file', controller.browseFile);

module.exports = router;
