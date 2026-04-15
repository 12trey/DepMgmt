const fs = require('fs');
const paths = require('../paths');

exports.get = (_req, res) => {
  const config = JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
  res.json(config);
};

exports.update = (req, res) => {
  const current = JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
  const updated = { ...current, ...req.body };
  fs.writeFileSync(paths.configPath, JSON.stringify(updated, null, 2));
  res.json(updated);
};
