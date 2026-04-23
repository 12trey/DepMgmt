const express = require('express');
const multer = require('multer');
const controller = require('../controllers/signController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.post('/file', upload.any(), controller.signFile);

module.exports = router;
