const express = require('express');
const controller = require('../controllers/gitController');

const router = express.Router();

router.post('/clone', controller.clone);
router.post('/pull', controller.pull);
router.post('/push', controller.push);
router.get('/status', controller.status);
router.post('/publish', controller.publish);
router.get('/log', controller.log);

module.exports = router;
