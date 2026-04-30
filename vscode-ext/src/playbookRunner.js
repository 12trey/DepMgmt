const { spawn } = require('child_process');

let _activeProc = null;

function isRunning() {
  return _activeProc !== null;
}

function stop() {
  if (_activeProc) {
    _activeProc.kill('SIGTERM');
    _activeProc = null;
  }
}

function buildVerbosityFlag(level) {
  if (!level || level <= 0) return [];
  return ['-' + 'v'.repeat(Math.min(level, 5))];
}

function run(options, outputChannel) {
  const { playbookPath, inventoryPath, ansibleConfig, repoFolder, ansibleBin, distro, verbosity } = options;

  if (_activeProc) {
    outputChannel.appendLine('[ansible-helper] A playbook is already running. Stop it first.');
    outputChannel.show(true);
    return;
  }

  const envParts = [
    ansibleConfig ? `ANSIBLE_CONFIG=${ansibleConfig}` : '',
    'ANSIBLE_DEPRECATION_WARNINGS=False',
    'ANSIBLE_COMMAND_WARNINGS=False',
    'ANSIBLE_ACTION_WARNINGS=False',
    'ANSIBLE_SYSTEM_WARNINGS=False',
  ].filter(Boolean);

  const bin = ansibleBin || 'ansible-playbook';
  const verbFlag = buildVerbosityFlag(verbosity);
  const cmdParts = [
    ...envParts,
    bin,
    '-i', inventoryPath,
    playbookPath,
    ...verbFlag,
  ];
  const shellCmd = `cd ${repoFolder} && ${cmdParts.join(' ')}`;

  const wslArgs = distro
    ? ['-d', distro, 'bash', '-c', shellCmd]
    : ['bash', '-c', shellCmd];

  outputChannel.clear();
  outputChannel.appendLine(`[ansible-helper] Running: ${shellCmd}`);
  outputChannel.appendLine('─'.repeat(60));
  outputChannel.show(true);

  _activeProc = spawn('wsl.exe', wslArgs);

  _activeProc.stdout.on('data', d => outputChannel.append(d.toString()));
  _activeProc.stderr.on('data', d => outputChannel.append(d.toString()));

  _activeProc.on('close', code => {
    _activeProc = null;
    outputChannel.appendLine('─'.repeat(60));
    outputChannel.appendLine(
      code === 0
        ? '[ansible-helper] Playbook completed successfully.'
        : `[ansible-helper] Playbook exited with code ${code}.`
    );
  });

  _activeProc.on('error', err => {
    _activeProc = null;
    outputChannel.appendLine(`[ansible-helper] Failed to start: ${err.message}`);
  });
}

module.exports = { run, stop, isRunning };
