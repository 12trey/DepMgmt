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

function run(options, outputChannel, { onData, onFinish } = {}) {
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

  const header = `[ansible-helper] Running: ${shellCmd}\n${'─'.repeat(60)}\n`;
  outputChannel.clear();
  outputChannel.appendLine(`[ansible-helper] Running: ${shellCmd}`);
  outputChannel.appendLine('─'.repeat(60));
  outputChannel.show(true);
  if (onData) onData(header);

  _activeProc = spawn('wsl.exe', wslArgs);

  _activeProc.stdout.on('data', d => {
    const text = d.toString();
    outputChannel.append(text);
    if (onData) onData(text);
  });

  _activeProc.stderr.on('data', d => {
    const text = d.toString();
    outputChannel.append(text);
    if (onData) onData(text);
  });

  _activeProc.on('close', code => {
    _activeProc = null;
    const footer = `${'─'.repeat(60)}\n` + (
      code === 0
        ? '[ansible-helper] Playbook completed successfully.\n'
        : `[ansible-helper] Playbook exited with code ${code}.\n`
    );
    outputChannel.appendLine('─'.repeat(60));
    outputChannel.appendLine(
      code === 0
        ? '[ansible-helper] Playbook completed successfully.'
        : `[ansible-helper] Playbook exited with code ${code}.`
    );
    if (onData) onData(footer);
    if (onFinish) onFinish(code);
  });

  _activeProc.on('error', err => {
    _activeProc = null;
    const msg = `[ansible-helper] Failed to start: ${err.message}\n`;
    outputChannel.appendLine(`[ansible-helper] Failed to start: ${err.message}`);
    if (onData) onData(msg);
    if (onFinish) onFinish(1);
  });
}

module.exports = { run, stop, isRunning };
