const express = require('express');
const controller = require('../controllers/executionController');

const router = express.Router();

router.post('/run', controller.run);
router.post('/run-wrapper', controller.runWrapper);
router.get('/status/:id', controller.status);
router.get('/logs', controller.listLogs);
router.get('/logs/:id', controller.getLog);

module.exports = router;
