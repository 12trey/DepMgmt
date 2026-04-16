const fs = require('fs');
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
  try {
    const meta = JSON.parse(req.body.meta);
    const fileRefs = JSON.parse(req.body.fileRefs || '[]'); // parallel array of node IDs
    const filesArr = req.files || [];

    // Map fileRef (node id) -> Buffer
    const fileBuffers = {};
    for (let i = 0; i < filesArr.length; i++) {
      if (fileRefs[i]) fileBuffers[fileRefs[i]] = filesArr[i].buffer;
    }

    const { msiPath, msiName, dir } = await msiService.buildMsi(meta, fileBuffers);
    buildDir = dir;

    res.download(msiPath, msiName, () => {
      try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch {}
    });
  } catch (err) {
    if (buildDir) {
      try { fs.rmSync(buildDir, { recursive: true, force: true }); } catch {}
    }
    res.status(500).json({ error: err.message });
  }
};
