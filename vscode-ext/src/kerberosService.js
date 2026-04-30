const { spawn } = require('child_process');

function wsl(distro, args) {
  const wslArgs = distro ? ['-d', distro, ...args] : args;
  return spawn('wsl.exe', wslArgs);
}

function run(distro, args) {
  return new Promise((resolve, reject) => {
    const proc = wsl(distro, args);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', d => (err += d));
    proc.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
    proc.on('error', reject);
  });
}

async function status(distro) {
  const { code, out } = await run(distro, ['klist']);
  if (code !== 0) return { valid: false, principal: '', expires: '' };

  const principalMatch = out.match(/Default principal:\s*(.+)/i);
  const expiresMatch = out.match(/(?:renew until|Expires)\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i);

  return {
    valid: true,
    principal: principalMatch ? principalMatch[1].trim() : '',
    expires: expiresMatch ? expiresMatch[1].trim() : '',
  };
}

function kinit(distro, username, password) {
  return new Promise((resolve, reject) => {
    const proc = wsl(distro, ['kinit', username]);
    let err = '';
    proc.stderr.on('data', d => (err += d));
    proc.stdout.on('data', () => {});
    proc.stdin.write(password + '\n');
    proc.stdin.end();
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `kinit exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function kdestroy(distro) {
  const { code, err } = await run(distro, ['kdestroy']);
  if (code !== 0) throw new Error(err || `kdestroy exited with code ${code}`);
}

module.exports = { status, kinit, kdestroy };
