const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const paths = require('../paths');

const repoPath = paths.repoDir;

function getConfig() {
  return JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
}

function getGit() {
  return simpleGit(repoPath);
}

exports.clone = async (url) => {
  const config = getConfig();
  const repoUrl = url || config.repository.url;
  if (!repoUrl) throw new Error('No repository URL configured');
  fs.mkdirSync(repoPath, { recursive: true });
  await simpleGit().clone(repoUrl, repoPath);
  return { message: 'Repository cloned', path: repoPath };
};

exports.pull = async () => {
  if (!fs.existsSync(path.join(repoPath, '.git'))) throw new Error('No git repository found');
  const result = await getGit().pull();
  return { message: 'Pull complete', summary: result };
};

exports.push = async () => {
  if (!fs.existsSync(path.join(repoPath, '.git'))) throw new Error('No git repository found');
  const result = await getGit().push();
  return { message: 'Push complete', result };
};

exports.status = async () => {
  if (!fs.existsSync(path.join(repoPath, '.git'))) {
    return { initialized: false };
  }
  const result = await getGit().status();
  return { initialized: true, ...result };
};
