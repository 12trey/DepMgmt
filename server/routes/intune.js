const express = require('express');
const controller = require('../controllers/intuneController');

const router = express.Router();

router.get('/status', controller.status);
router.post('/download', controller.download);
router.post('/build', controller.build);
router.get('/check-output', controller.checkOutput);
router.post('/clear-output', controller.clearOutput);

module.exports = router;
