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
  const { setupFolder, sourceFile, outputFolder, quiet, addCatalog, catalogFolder } = req.body;
  if (!setupFolder || !sourceFile || !outputFolder) {
    return res.status(400).json({ error: 'setupFolder, sourceFile, and outputFolder are required' });
  }
  const execId = intuneService.buildIntuneWin({
    setupFolder,
    sourceFile,
    outputFolder,
    quiet: !!quiet,
    addCatalog: !!addCatalog,
    catalogFolder,
  });
  res.json({ id: execId });
};
