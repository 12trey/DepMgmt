const { spawn } = require('child_process');
const yaml = require('js-yaml');

function wslArgs(distro, cmd) {
  return distro ? ['-d', distro, ...cmd] : cmd;
}

function readWslFile(wslPath, distro) {
  return new Promise((resolve, reject) => {
    const args = wslArgs(distro, ['cat', wslPath]);
    const proc = spawn('wsl.exe', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', d => (err += d));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim() || `wsl cat exited ${code}`));
      resolve(out);
    });
    proc.on('error', reject);
  });
}

async function loadCustomSnippets(wslPath, distro) {
  if (!wslPath) return [];
  try {
    const content = await readWslFile(wslPath, distro);
    const parsed = yaml.load(content);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      s => s && typeof s.name === 'string' && typeof s.snippet === 'string'
    );
  } catch {
    return [];
  }
}

module.exports = { loadCustomSnippets };
