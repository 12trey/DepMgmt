const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { signMsi: signFile } = require('../services/msiService');

exports.signFile = async (req, res) => {
  let tmpDir = null;
  let tmpPfx = null;
  try {
    const signing = req.body.signing ? JSON.parse(req.body.signing) : null;
    if (!signing?.method) return res.status(400).json({ error: 'No signing method specified' });

    const targetFile = (req.files || []).find(f => f.fieldname === 'file');
    const pfxFile = (req.files || []).find(f => f.fieldname === 'pfxFile');
    if (!targetFile) return res.status(400).json({ error: 'No file uploaded' });

    tmpDir = path.join(os.tmpdir(), `sign_${uuidv4()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, targetFile.originalname);
    fs.writeFileSync(filePath, targetFile.buffer);

    if (signing.method === 'pfx') {
      if (!pfxFile) return res.status(400).json({ error: 'PFX file was not uploaded' });
      tmpPfx = path.join(os.tmpdir(), `sign_${uuidv4()}.pfx`);
      fs.writeFileSync(tmpPfx, pfxFile.buffer);
      signing.pfxPath = tmpPfx;
    }

    await signFile(filePath, signing);

    res.download(filePath, targetFile.originalname, () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      if (tmpPfx) { try { fs.unlinkSync(tmpPfx); } catch {} }
    });
  } catch (err) {
    if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
    if (tmpPfx) { try { fs.unlinkSync(tmpPfx); } catch {} }
    res.status(500).json({ error: err.message });
  }
};
