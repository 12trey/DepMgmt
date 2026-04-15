const gitService = require('../services/gitService');
const packageService = require('../services/packageService');

exports.clone = async (req, res) => {
  try {
    const { url } = req.body;
    const result = await gitService.clone(url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.pull = async (_req, res) => {
  try {
    const result = await gitService.pull();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.push = async (_req, res) => {
  try {
    const result = await gitService.push();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.status = async (_req, res) => {
  try {
    const result = await gitService.status();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.publish = async (req, res) => {
  try {
    const { appName, version } = req.body;
    if (!appName || !version) return res.status(400).json({ error: 'appName and version are required' });
    const result = await gitService.publish(appName, version);
    await packageService.update(appName, version, { status: 'published' }).catch(() => {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.log = async (_req, res) => {
  try {
    const result = await gitService.log();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
