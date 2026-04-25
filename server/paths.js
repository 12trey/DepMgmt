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

// Writable: user-customized templates. Kept separate from the bundled templates/
// directory so dev mode never treats source files as custom overrides.
const customTemplatesDir = isPackaged
  ? path.join(userDataDir, 'templates')
  : path.join(appRoot, '.userdata', 'templates');

// Read-only: built React client
const clientDist = path.join(appRoot, 'client', 'dist');

// Writable paths
const configPath = path.join(userDataDir, 'config.json');

// Read optional path overrides from config.json (strip any accidental surrounding quotes)
function stripQuotes(s) { return typeof s === 'string' ? s.replace(/^["']|["']$/g, '').trim() : s; }

// Read the current config from disk each time (so path changes take effect without restart)
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf-8')); } catch { return {}; }
}

// Startup-time defaults (used for initial directory creation only)
const _startupConfig = readConfig();
const _startupPackagesDir = stripQuotes(_startupConfig?.packages?.basePath) || path.join(userDataDir, 'packages');

const logsDir = path.join(userDataDir, 'logs');

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
fs.mkdirSync(_startupPackagesDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

module.exports = {
  isPackaged,
  appRoot,
  userDataDir,
  templatesDir,
  customTemplatesDir,
  clientDist,
  configPath,
  // Dynamic getters — re-read config.json on every access so path changes
  // made via the Settings UI take effect immediately without a server restart.
  get packagesDir() {
    const c = readConfig();
    return stripQuotes(c?.packages?.basePath) || path.join(userDataDir, 'packages');
  },
  get repoDir() {
    const c = readConfig();
    return stripQuotes(c?.repository?.localPath) || path.join(userDataDir, 'repo');
  },
  logsDir,
  ansibleAppDir,
};
