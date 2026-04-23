const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const msiService = require('../services/msiService');

exports.probe = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No MSI file uploaded' });
    const info = await msiService.probeMsi(req.file.buffer);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.detectTools = async (_req, res) => {
  try {
    const result = await msiService.detectWix();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.build = async (req, res) => {
  let buildDir = null;
  let tmpPfx = null;
  try {
    const meta = JSON.parse(req.body.meta);
    const fileRefs = JSON.parse(req.body.fileRefs || '[]');
    const signing = req.body.signing ? JSON.parse(req.body.signing) : null;
    const filesArr = req.files || [];

    // Separate PFX upload from installer files.
    // multer upload.any() names: installer files use fieldname 'files', PFX uses 'pfxFile'.
    const pfxFile = filesArr.find(f => f.fieldname === 'pfxFile');
    const installerFiles = filesArr.filter(f => f.fieldname !== 'pfxFile');

    // Map fileRef (node id) -> Buffer
    const fileBuffers = {};
    for (let i = 0; i < installerFiles.length; i++) {
      if (fileRefs[i]) fileBuffers[fileRefs[i]] = installerFiles[i].buffer;
    }

    const { msiPath, msiName, dir } = await msiService.buildMsi(meta, fileBuffers);
    buildDir = dir;

    // Optional code signing
    if (signing?.method) {
      if (signing.method === 'pfx') {
        if (!pfxFile) throw new Error('PFX file was not uploaded');
        tmpPfx = path.join(os.tmpdir(), `sign_${uuidv4()}.pfx`);
        fs.writeFileSync(tmpPfx, pfxFile.buffer);
        signing.pfxPath = tmpPfx;
      }
      await msiService.signMsi(msiPath, signing);
    }

    res.download(msiPath, msiName, () => {
      try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch {}
      if (tmpPfx) { try { fs.unlinkSync(tmpPfx); } catch {} }
    });
  } catch (err) {
    if (buildDir) { try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch {} }
    if (tmpPfx) { try { fs.unlinkSync(tmpPfx); } catch {} }
    res.status(500).json({ error: err.message });
  }
};
