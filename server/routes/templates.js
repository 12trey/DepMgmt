const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/templateController');

router.get('/:version/:file', ctrl.readTemplate);
router.put('/:version/:file', ctrl.saveTemplate);
router.delete('/:version/:file', ctrl.resetTemplate);

module.exports = router;
