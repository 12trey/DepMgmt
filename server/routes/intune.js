const express = require('express');
const controller = require('../controllers/intuneController');

const router = express.Router();

router.get('/status', controller.status);
router.post('/download', controller.download);
router.post('/build', controller.build);

module.exports = router;
