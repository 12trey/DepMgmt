const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { broadcast } = require('./logStream');

const paths = require('../paths');
const packageService = require('./packageService');
const logsDir = paths.logsDir;

function getConfig() {
  return JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
}

// In-memory execution tracker
const executions = new Map();

function runScript(scriptPath, mode, execId) {
  return new Promise((resolve, reject) => {
    const config = getConfig();
    const psArgs = [
      ...config.execution.defaultArgs,
      '-File',
      scriptPath,
      `-DeploymentType`,
      'Install',
      `-DeployMode`,
      mode,
    ];

    // In packaged Electron the inherited PSModulePath may be empty or incomplete, causing both
    // Get-Module -ListAvailable to miss CurrentUser-installed modules AND transitive RequiredModules
    // (e.g. Microsoft.PowerShell.Archive) to fail resolution. Reconstruct the full standard path.
    const userProfile = process.env.USERPROFILE || '';
    const sysRoot = process.env.SystemRoot || 'C:\\Windows';
    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const standardModPaths = [
      // CurrentUser installs (PS5.1 and PS7)
      ...(userProfile ? [
        path.join(userProfile, 'Documents', 'WindowsPowerShell', 'Modules'),
        path.join(userProfile, 'Documents', 'PowerShell', 'Modules'),
      ] : []),
      // AllUsers installs
      path.join(progFiles, 'WindowsPowerShell', 'Modules'),
      path.join(progFiles, 'PowerShell', 'Modules'),
      // Windows built-in modules (Microsoft.PowerShell.Archive, etc.)
      path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
    ];
    const baseParts = (process.env.PSModulePath || '').split(';').filter(Boolean);
    const mergedParts = [...new Set([...standardModPaths, ...baseParts])];
    const spawnEnv = { ...process.env, PSModulePath: mergedParts.join(';') };

    const child = spawn(config.execution.powershellPath, psArgs, { cwd: path.dirname(scriptPath), env: spawnEnv });
    const logLines = [];

    const onData = (stream) => (chunk) => {
      const text = chunk.toString();
      logLines.push(text);
      broadcast(execId, text, stream);
    };

    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));

    child.on('close', (code) => {
      const status = code === 0 ? 'Success' : 'Failed';
      executions.set(execId, { ...executions.get(execId), status, exitCode: code, endedAt: new Date().toISOString() });
      // Persist log
      fs.writeFileSync(path.join(logsDir, `${execId}.log`), logLines.join(''));
      fs.writeFileSync(
        path.join(logsDir, `${execId}.json`),
        JSON.stringify(executions.get(execId), null, 2)
      );
      broadcast(execId, `\n--- Execution ${status} (exit code ${code}) ---\n`, 'system');
      resolve({ status, exitCode: code });
    });

    child.on('error', (err) => {
      executions.set(execId, { ...executions.get(execId), status: 'Failed', error: err.message });
      broadcast(execId, `Error: ${err.message}\n`, 'stderr');
      reject(err);
    });
  });
}

exports.runPackage = async (appName, version, mode) => {
  const scriptPath = packageService.getEntryScript(appName, version);
  if (!fs.existsSync(scriptPath)) throw new Error('Deploy script not found');

  const execId = uuidv4();
  const meta = { id: execId, appName, version, mode, status: 'Running', startedAt: new Date().toISOString() };
  executions.set(execId, meta);
  broadcast(execId, `Starting deployment: ${appName} v${version} [${mode}]\n`, 'system');

  // Run in background, don't await
  runScript(scriptPath, mode, execId).catch(() => {});

  return { id: execId, status: 'Running' };
};

exports.runWrapper = async (steps) => {
  const wrapperId = uuidv4();
  const meta = { id: wrapperId, type: 'wrapper', steps, status: 'Running', startedAt: new Date().toISOString() };
  executions.set(wrapperId, meta);

  (async () => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const scriptPath = packageService.getEntryScript(step.appName, step.version);
      if (!fs.existsSync(scriptPath)) {
        broadcast(wrapperId, `Step ${i + 1}: Script not found for ${step.appName}\n`, 'stderr');
        continue;
      }
      broadcast(wrapperId, `\n=== Step ${i + 1}/${steps.length}: ${step.appName} v${step.version} ===\n`, 'system');
      try {
        await runScript(scriptPath, step.mode || 'Silent', wrapperId);
      } catch {
        broadcast(wrapperId, `Step ${i + 1} failed, continuing...\n`, 'stderr');
      }
    }
    executions.set(wrapperId, { ...executions.get(wrapperId), status: 'Completed', endedAt: new Date().toISOString() });
  })();

  return { id: wrapperId, status: 'Running' };
};

exports.getStatus = (id) => {
  const exec = executions.get(id);
  if (!exec) throw new Error('Execution not found');
  return exec;
};

exports.listLogs = async () => {
  if (!fs.existsSync(logsDir)) return [];
  return fs
    .readdirSync(logsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(logsDir, f), 'utf-8')))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
};

exports.getLog = async (id) => {
  const logPath = path.join(logsDir, `${id}.log`);
  const metaPath = path.join(logsDir, `${id}.json`);
  if (!fs.existsSync(logPath)) throw new Error('Log not found');
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf-8')) : {};
  const log = fs.readFileSync(logPath, 'utf-8');
  return { ...meta, log };
};
