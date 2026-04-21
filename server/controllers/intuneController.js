const { v4: uuidv4 } = require('uuid');
const intuneService = require('../services/intuneService');
const logStream = require('../services/logStream');

exports.status = (req, res) => {
  res.json(intuneService.checkTool());
};

exports.download = (req, res) => {
  const execId = uuidv4();
  // Respond immediately with the exec ID so the client can subscribe to WS
  res.json({ id: execId });

  intuneService
    .downloadTool((msg) => logStream.broadcast(execId, msg, 'system'))
    .then(() => {
      logStream.broadcast(execId, '__DONE__', 'system');
    })
    .catch((err) => {
      logStream.broadcast(execId, `Error: ${err.message}`, 'stderr');
      logStream.broadcast(execId, '__DONE__', 'system');
    });
};

exports.build = (req, res) => {
  const { setupFolder, sourceFile, outputFolder, addCatalog, catalogFolder } = req.body;
  if (!setupFolder || !sourceFile || !outputFolder) {
    return res.status(400).json({ error: 'setupFolder, sourceFile, and outputFolder are required' });
  }
  const execId = intuneService.buildIntuneWin({
    setupFolder,
    sourceFile,
    outputFolder,
    addCatalog: !!addCatalog,
    catalogFolder,
  });
  res.json({ id: execId });
};

exports.checkOutput = (req, res) => {
  const { folder } = req.query;
  if (!folder) return res.status(400).json({ error: 'folder is required' });
  res.json(intuneService.checkOutputFolder(folder));
};

exports.clearOutput = (req, res) => {
  const { folder } = req.body;
  if (!folder) return res.status(400).json({ error: 'folder is required' });
  try {
    intuneService.clearOutputFolder(folder);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
