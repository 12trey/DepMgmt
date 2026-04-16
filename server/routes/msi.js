const express = require('express');
const multer = require('multer');
const controller = require('../controllers/msiController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.get('/detect-tools', controller.detectTools);
router.post('/probe', upload.single('file'), controller.probe);
router.post('/build', upload.any(), controller.build);

module.exports = router;
