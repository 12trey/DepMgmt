const path = require('path');
const fs = require('fs');
const electron = (() => { try { return require('electron'); } catch { return null; } })();

// When packaged with electron-builder:
//   app.getAppPath()  → ...resources/app.asar  (read-only code)
//   process.resourcesPath → ...resources        (extraResources land here)
//   app.getPath('userData') → %APPDATA%/AIPSADT (writable per-user data)
//
// In dev / plain node:
//   Everything is relative to project root.

const isPackaged = electron && electron.app && electron.app.isPackaged;

// Root of the source code (inside asar when packaged)
const appRoot = isPackaged
  ? electron.app.getAppPath()
  : path.resolve(__dirname, '..');

// Writable directory for user data (config, packages, logs, repo)
const userDataDir = isPackaged
  ? electron.app.getPath('userData')
  : path.resolve(__dirname, '..');

// Read-only: templates ship with the app
const templatesDir = path.join(appRoot, 'templates');

// Read-only: built React client
const clientDist = path.join(appRoot, 'client', 'dist');

// Writable paths
const configPath = path.join(userDataDir, 'config.json');
const packagesDir = path.join(userDataDir, 'packages');
const logsDir = path.join(userDataDir, 'logs');
const repoDir = path.join(userDataDir, 'repo');

// On first run in packaged mode, copy default config if it doesn't exist yet
if (isPackaged && !fs.existsSync(configPath)) {
  const defaultConfig = path.join(appRoot, 'config.json');
  if (fs.existsSync(defaultConfig)) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.copyFileSync(defaultConfig, configPath);
  }
}

// Ansible app source — included in the Electron build under ansible-app/
// In dev mode this is the project root; in packaged mode it is alongside the other app files.
const ansibleAppDir = path.join(appRoot, 'ansible-app');

// Ensure writable directories exist
fs.mkdirSync(packagesDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

module.exports = {
  isPackaged,
  appRoot,
  userDataDir,
  templatesDir,
  clientDist,
  configPath,
  packagesDir,
  logsDir,
  repoDir,
  ansibleAppDir,
};
