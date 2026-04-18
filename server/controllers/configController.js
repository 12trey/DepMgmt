const fs = require('fs');
const paths = require('../paths');

exports.get = (_req, res) => {
  const config = JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
  res.json(config);
};

function stripQuotes(s) { return typeof s === 'string' ? s.replace(/^["']|["']$/g, '').trim() : s; }

exports.update = (req, res) => {
  const current = JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
  const body = req.body;
  // Strip accidental surrounding quotes from path fields
  if (body.packages?.basePath) body.packages.basePath = stripQuotes(body.packages.basePath);
  if (body.repository?.localPath) body.repository.localPath = stripQuotes(body.repository.localPath);
  const updated = { ...current, ...body };
  fs.writeFileSync(paths.configPath, JSON.stringify(updated, null, 2));
  res.json(updated);
};
