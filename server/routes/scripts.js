const express = require('express');
const ctrl = require('../controllers/scriptController');

const router = express.Router();

router.get('/browse', ctrl.browse);
router.get('/parse', ctrl.parseScript);
router.post('/run', ctrl.runScript);
router.get('/mggraph/status', ctrl.mgGraphStatus);
router.post('/mggraph/install', ctrl.mgGraphInstall);
router.post('/mggraph/connect', ctrl.mgGraphConnect);
router.post('/mggraph/disconnect', ctrl.mgGraphDisconnect);

router.get('/az/status', ctrl.azStatus);
router.post('/az/install', ctrl.azInstall);
router.post('/az/connect', ctrl.azConnect);
router.post('/az/disconnect', ctrl.azDisconnect);

module.exports = router;
