const express = require('express');
const controller = require('../controllers/configController');

const router = express.Router();

router.get('/', controller.get);
router.put('/', controller.update);

module.exports = router;
