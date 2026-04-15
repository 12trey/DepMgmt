const gitService = require('../services/gitService');

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
