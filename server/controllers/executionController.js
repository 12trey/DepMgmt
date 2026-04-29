const executionService = require('../services/executionService');

function parseTargets(target) {
  if (!target || !target.trim()) return [];
  return target.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

exports.run = async (req, res) => {
  try {
    const { appName, version, mode, deploymentType, target, username, password } = req.body;
    const targets = parseTargets(target);
    let result;
    if (targets.length === 0) {
      result = await executionService.runPackage(appName, version, mode || 'Silent', deploymentType || 'Install', username || undefined, password || undefined);
    } else {
      result = await executionService.runMultiTarget(appName, version, mode || 'Silent', deploymentType || 'Install', targets, username || undefined, password || undefined);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.runWrapper = async (req, res) => {
  try {
    const { steps, target, username, password } = req.body;
    const targets = parseTargets(target);
    const result = await executionService.runWrapper(steps, targets, username || undefined, password || undefined);
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
