const executionService = require('../services/executionService');

exports.run = async (req, res) => {
  try {
    const { appName, version, mode, deploymentType, target, username, password } = req.body;
    const result = target
      ? await executionService.runRemote(appName, version, mode || 'Silent', target, username, password, deploymentType || 'Install')
      : await executionService.runPackage(appName, version, mode || 'Silent', deploymentType || 'Install');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.runWrapper = async (req, res) => {
  try {
    const { steps } = req.body; // [{ appName, version, mode }]
    const result = await executionService.runWrapper(steps);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.status = async (req, res) => {
  try {
    const status = executionService.getStatus(req.params.id);
    res.json(status);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

exports.listLogs = async (_req, res) => {
  try {
    const logs = await executionService.listLogs();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getLog = async (req, res) => {
  try {
    const log = await executionService.getLog(req.params.id);
    res.json(log);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};
