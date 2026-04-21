const express = require('express');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const paths = require('../paths');

const execFileAsync = promisify(execFile);
const router = express.Router();

const APP_PORT = 7000;
const APP_PATH = '/home/ansibleapp';
const APP_ENTRY = '/home/ansibleapp/app.js';
const PYTHON_VENV = '/opt/.ansiblevenv';
const REQUIRED_PACKAGES = ['krb5-user', 'python3', 'python3-pip', 'python3-venv', 'python3.12-venv', 'rsync', 'curl', 'wget', 'jq'];

// Convert a Windows absolute path to a WSL /mnt/ path
function toWslPath(winPath) {
  return winPath
    .replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`)
    .replace(/\\/g, '/');
}

// ansible-app source visible from inside WSL via the Windows /mnt/ filesystem bridge
const ANSIBLE_APP_WSL = toWslPath(paths.ansibleAppDir);

// Run a command inside a WSL instance by piping it via stdin to a login shell.
// Spawning 'bash -l' and writing to stdin avoids both Windows argument-quoting
// issues AND the \n-escaping problem that JSON.stringify causes with bash -c.
function wslExec(instance, command) {
  return new Promise((resolve, reject) => {
    const args = instance ? ['-d', instance, 'bash', '-l'] : ['bash', '-l'];
    const child = spawn('wsl.exe', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => {
      if (code !== 0) return reject(new Error(stderr.trim() || `exit ${code}`));
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on('error', reject);
    child.stdin.write(command + '\n');
    child.stdin.end();
  });
}

// GET /api/wsl/instances — list available WSL distros
router.get('/instances', async (_req, res) => {
  try {
    // wsl --list --quiet outputs distro names, one per line (may have \r\n and BOM)
    const { stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], { timeout: 10000 });
    const instances = stdout
      .split(/\r?\n/)
      .map(line => line.replace(/\0/g, '').trim()) // strip NUL bytes from UTF-16 output
      .filter(Boolean);
    res.json({ instances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/wsl/debug?instance=NAME — raw diagnostics to help troubleshoot node detection
router.get('/debug', async (req, res) => {
  const { instance } = req.query;
  if (!instance) return res.status(400).json({ error: 'instance query param required' });
  try {
    const script = [
      'echo "=== whoami ===" && whoami',
      'echo "=== HOME ===" && echo $HOME',
      'echo "=== PATH ===" && echo $PATH',
      'echo "=== which node ===" && which node 2>&1 || echo "(not found)"',
      'echo "=== NVM_DIR ===" && echo ${NVM_DIR:-"(not set)"}',
      'echo "=== ~/.nvm exists ===" && ([ -d "$HOME/.nvm" ] && echo yes || echo no)',
      'echo "=== nvm.sh exists ===" && ([ -s "$HOME/.nvm/nvm.sh" ] && echo yes || echo no)',
      'echo "=== NVM versions dir ===" && ls $HOME/.nvm/versions/node 2>/dev/null || echo "(empty or missing)"',
      'echo "=== find node binary ===" && find $HOME/.nvm/versions -name node -type f 2>/dev/null || echo "(none found)"',
      'echo "=== source nvm then which node ===" && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && which node 2>&1 || echo "(still not found)"',
      'echo "=== ~/.bashrc nvm lines ===" && grep -i nvm $HOME/.bashrc 2>/dev/null || echo "(none)"',
      'echo "=== ~/.bash_profile exists ===" && ([ -f "$HOME/.bash_profile" ] && echo yes || echo no)',
      'echo "=== ~/.profile nvm lines ===" && grep -i nvm $HOME/.profile 2>/dev/null || echo "(none)"',
    ].join('\n');
    const r = await wslExec(instance, script);
    res.type('text/plain').send(r.stdout + (r.stderr ? '\nSTDERR:\n' + r.stderr : ''));
  } catch (err) {
    res.status(500).type('text/plain').send(err.message);
  }
});

// GET /api/wsl/app-log?instance=NAME — return last 100 lines of /tmp/dmt-app.log
router.get('/app-log', async (req, res) => {
  const { instance } = req.query;
  if (!instance) return res.status(400).json({ error: 'instance query param required' });
  try {
    const r = await wslExec(instance, 'tail -n 100 /tmp/dmt-app.log 2>/dev/null || echo "(log empty or missing)"');
    res.type('text/plain').send(r.stdout);
  } catch (err) {
    res.status(500).type('text/plain').send(err.message);
  }
});

// POST /api/wsl/check — check ansible/node setup in a WSL instance
// Body: { instance }
router.post('/check', async (req, res) => {
  const { instance } = req.body;
  if (!instance) return res.status(400).json({ error: 'instance is required' });

  const checks = {};

  try {
    // Check system packages
    const missingPkgs = [];
    for (const pkg of REQUIRED_PACKAGES) {
      try {
        await wslExec(instance, `dpkg -l | grep -q "^ii  ${pkg}"`);
        checks[pkg] = true;
      } catch {
        checks[pkg] = false;
        missingPkgs.push(pkg);
      }
    }
    checks.missingPackages = missingPkgs;

    // Check python venv (must have been created with the system python, not the Windows one)
    try {
      await wslExec(instance, `test -f "${PYTHON_VENV}/bin/python3"`);
      checks.pythonVenv = true;
    } catch {
      checks.pythonVenv = false;
    }

    // Check ansible
    try {
      const r = await wslExec(instance, `"${PYTHON_VENV}/bin/ansible" --version 2>/dev/null | head -1`);
      checks.ansible = r.stdout.length > 0;
    } catch {
      checks.ansible = false;
    }

    // Check node — installed system-wide via NodeSource, just check PATH
    try {
      const r = await wslExec(instance, 'node --version 2>/dev/null');
      checks.node = r.stdout.startsWith('v');
      checks.nodeVersion = r.stdout || null;
    } catch {
      checks.node = false;
      checks.nodeVersion = null;
    }

    // Check app directory
    try {
      await wslExec(instance, `test -d "${APP_PATH}"`);
      checks.appDir = true;
    } catch {
      checks.appDir = false;
    }

    // Check app entry point
    try {
      await wslExec(instance, `test -f "${APP_ENTRY}"`);
      checks.appEntry = true;
    } catch {
      checks.appEntry = false;
    }

    const ready = checks.node && checks.appDir && checks.appEntry;
    res.json({ checks, ready });
  } catch (err) {
    res.status(500).json({ error: err.message, checks });
  }
});

// POST /api/wsl/setup — run ansible setup script in a WSL instance (streams output via SSE)
// Body: { instance, runAsRoot?, krb5?: { realm, kdcServers, adminServer, defaultDomain, timezone } }
router.post('/setup', (req, res) => {
  const { instance, runAsRoot, krb5 = {} } = req.body;
  if (!instance) return res.status(400).json({ error: 'instance is required' });

  // Build krb5.conf content in JS so it works for any user (not reliant on bash variables
  // that only exist under the root user's environment).
  const realm         = (krb5.realm        || '').trim().toUpperCase();
  const kdcServers    = (Array.isArray(krb5.kdcServers) ? krb5.kdcServers : []).map(s => s.trim()).filter(Boolean);
  const adminServer   = (krb5.adminServer  || '').trim() || kdcServers[0] || '';
  const defaultDomain = (krb5.defaultDomain || '').trim() || realm.toLowerCase();
  const timezone      = (krb5.timezone     || 'America/New_York').trim();
  const kdcLines      = kdcServers.map(s => `        kdc = ${s}`).join('\n');

  // Emit either the full krb5.conf tee block or a skip notice
  const krb5ConfBlock = realm && kdcServers.length ? `\
# Write krb5.conf if not already configured for this realm
if ! grep -q "default_realm = ${realm}" /etc/krb5.conf 2>/dev/null; then
    echo "    [INFO] Configuring /etc/krb5.conf for realm ${realm}..."
    sudo tee /etc/krb5.conf > /dev/null << 'KRBEREALM'
[libdefaults]
    default_realm = ${realm}

# The following krb5.conf variables are only for MIT Kerberos.
    kdc_timesync = 1
    ccache_type = 4
    forwardable = true
    proxiable = true
    rdns = false


# The following libdefaults parameters are only for Heimdal Kerberos.
    fcc-mit-ticketflags = true

[realms]
    ${realm} = {
${kdcLines}
        admin_server = ${adminServer}
        default_domain = ${defaultDomain}
    }

[domain_realm]
    .${defaultDomain} = ${realm}
    ${defaultDomain} = ${realm}
KRBEREALM
else
    echo "    [INFO] /etc/krb5.conf already configured for ${realm}. Skipping."
fi` : `echo "    [WARN] No Kerberos realm provided — skipping krb5.conf setup."`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Build the script as a plain string and pipe it via stdin.
  // Passing a large multi-line script as a -c argument through Windows spawn
  // mangles double-quote assignments (e.g. VAR="value" arrives as VAR=).
  const setupScript = `
set -e

# Set timezone
if [ -f /etc/timezone ]; then
    echo "    [INFO] Setting timezone to ${timezone}..."
    sudo sh -c "echo ${timezone} > /etc/timezone"
else
    echo "    [WARN] Could not find /etc/timezone, skipping timezone setup."
fi

${krb5ConfBlock}

export DEBIAN_FRONTEND=noninteractive

# Use only the standard Linux PATH so WSL does not pick up Windows binaries
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

SYSTEM_DEPS="krb5-user python3 python3-pip python3-venv python3.12-venv gcc python3-dev libkrb5-dev rsync curl wget sudo jq"
echo "==> Updating package lists..."
sudo apt-get update -q
echo "==> Installing system dependencies..."
sudo -E apt-get install -y $SYSTEM_DEPS

PYTHON_VENV_DIR=${PYTHON_VENV}
if [ ! -d "$PYTHON_VENV_DIR" ]; then
  echo "==> Creating Python virtual environment..."
  /usr/bin/python3 -m venv "$PYTHON_VENV_DIR"
  chmod -R 755 "$PYTHON_VENV_DIR"
else
  echo "==> Python virtual environment already exists."
fi

VENV_BIN="$PYTHON_VENV_DIR/bin"
export PATH="$VENV_BIN:$PATH"

"$VENV_BIN/pip3" show ansible-core > /dev/null 2>&1 || (echo "==> Installing ansible-core..." && "$VENV_BIN/pip3" install ansible-core)
"$VENV_BIN/pip3" show pywinrm    > /dev/null 2>&1 || (echo "==> Installing pywinrm[kerberos]..." && "$VENV_BIN/pip3" install 'pywinrm[kerberos]')

mkdir -p /usr/share/ansible/collections
chmod 755 /usr/share/ansible/collections
"$VENV_BIN/ansible-galaxy" collection install ansible.windows --ignore-certs --force -p /usr/share/ansible/collections || echo "==> Failed to install ansible.windows collection, but continuing anyway…"
"$VENV_BIN/ansible-galaxy" collection install ansible.posix --ignore-certs --force -p /usr/share/ansible/collections || echo "==> Failed to install ansible.posix collection, but continuing anyway…"

echo "==> Checking for Node.js..."
if ! command -v node > /dev/null 2>&1; then
  echo "==> Setting up NodeSource LTS repository..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
  apt-get install -y nodejs
  echo "==> Node.js installed: $(node --version)"
else
  echo "==> Node already available: $(node --version)"
fi

echo "==> Syncing Ansible app from host (${ANSIBLE_APP_WSL})..."
if [ ! -d "${ANSIBLE_APP_WSL}" ] || [ -z "$(ls -A "${ANSIBLE_APP_WSL}" 2>/dev/null | grep -v '.gitkeep')" ]; then
  echo "==> ERROR: ansible-app/ directory is missing or empty in the PSADT project."
  echo "==>        Populate it by cloning: git clone <repo> ansible-app"
  exit 1
fi
mkdir -p ${APP_PATH}
rsync -av --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='my-react-app/node_modules' \
  --exclude='my-react-app/dist' \
  "${ANSIBLE_APP_WSL}/" "${APP_PATH}/"

if [ ! -d ${APP_PATH} ]; then
  echo "==> ERROR: App directory ${APP_PATH} not found after sync."
  exit 1
fi

cd ${APP_PATH}
if [ -f package.json ]; then
  echo "==> Installing npm dependencies..."
  npm install
fi

cd ${APP_PATH}/my-react-app
if [ -f package.json ]; then
  echo "==> Installing npm dependencies..."
  npm install
  npm run build
fi


# Fix ownership so the default WSL user can write to the app directory after root install
DEFAULT_USER=$(getent passwd 1000 | cut -d: -f1 2>/dev/null || id -un 1000 2>/dev/null || echo "")
if [ -n "$DEFAULT_USER" ]; then
  echo "==> Transferring ownership of ${APP_PATH} to $DEFAULT_USER..."
  chown -R "$DEFAULT_USER:$DEFAULT_USER" "${APP_PATH}"
else
  echo "==> [WARN] Could not determine UID 1000 user — skipping chown."
fi

echo "==> Setup complete!"
`;

  // The setup script writes to /opt and /home/ansibleapp — system paths that
  // require root. Rather than prefixing every individual command with sudo,
  // run the entire script as root via wsl.exe -u root. WSL permits this from
  // the Windows side without Linux-level authentication, so it works whether
  // the instance's default user is root or a non-root sudoer.
  const args = runAsRoot
    ? ['-d', instance, '-u', 'root', 'bash', '-l']
    : ['-d', instance, 'bash', '-l'];
  const child = spawn('wsl.exe', args, { windowsHide: true });
  child.stdin.write(setupScript);
  child.stdin.end();

  child.stdout.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach(line => send({ type: 'stdout', line }));
  });
  child.stderr.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach(line => send({ type: 'stderr', line }));
  });
  child.on('close', (code) => {
    send({ type: 'exit', code });
    res.end();
  });
  child.on('error', (err) => {
    send({ type: 'error', message: err.message });
    res.end();
  });
});

// POST /api/wsl/launch — launch the ansible app inside WSL (non-blocking)
// Body: { instance }
router.post('/launch', async (req, res) => {
  const { instance } = req.body;
  if (!instance) return res.status(400).json({ error: 'instance is required' });

  try {
    // Write the launch script to a file in WSL
    await wslExec(instance, `
cat > /tmp/dmt-launch.sh << 'EOLAUNCH'
#!/bin/bash -l
# Activate the Python venv so ansible-playbook is on PATH for child processes
[ -f "/opt/.ansiblevenv/bin/activate" ] && . "/opt/.ansiblevenv/bin/activate"
cd ${APP_PATH}
exec node ${APP_ENTRY} >> /tmp/dmt-app.log 2>&1
EOLAUNCH
chmod +x /tmp/dmt-launch.sh
`);

    // Spawn wsl.exe running bash in the foreground (node runs via exec, keeping wsl.exe alive).
    // windowsHide:true works for non-detached processes — confirmed working by the setup spawn.
    // unref() lets the Express server continue without waiting for this child to exit.
    const child = spawn('wsl.exe', ['-d', instance, '--cd', `${APP_PATH}`, 'bash', '-l', '/tmp/dmt-launch.sh'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    res.json({ launched: true, instance, port: APP_PORT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wsl/sync — rsync ansible-app/ into WSL, rebuild the React app, and restart app.js
// Body: { instance }
router.post('/sync', async (req, res) => {
  const { instance } = req.body;
  if (!instance) return res.status(400).json({ error: 'instance is required' });

  try {
    // 1. Sync files
    await wslExec(instance, `
rsync -av --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='my-react-app/node_modules' \
  --exclude='my-react-app/dist' \
  "${ANSIBLE_APP_WSL}/" "${APP_PATH}/"
`);

    // 2. Rebuild the embedded React app
    await wslExec(instance, `cd "${APP_PATH}/my-react-app" && npm run build`);

    // 3. Kill the existing app.js process (ignore error if it wasn't running)
    await wslExec(instance, `pkill -f "node ${APP_ENTRY}" || true`).catch(() => {});

    // 4. Relaunch app.js (same mechanism as /launch)
    await wslExec(instance, `
cat > /tmp/dmt-launch.sh << 'EOLAUNCH'
#!/bin/bash -l
[ -f "/opt/.ansiblevenv/bin/activate" ] && . "/opt/.ansiblevenv/bin/activate"
cd ${APP_PATH}
exec node ${APP_ENTRY} >> /tmp/dmt-app.log 2>&1
EOLAUNCH
chmod +x /tmp/dmt-launch.sh
`);
    const child = spawn('wsl.exe', ['-d', instance, '--cd', `${APP_PATH}`, 'bash', '-l', '/tmp/dmt-launch.sh'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    res.json({ synced: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Attach a WebSocketServer that spawns a login shell in the named WSL instance.
// One shell per WebSocket connection. Uses Python's pty module inside WSL to
// allocate a real pseudo-terminal so bash shows PS1 prompts and the PTY layer
// converts \n→\r\n (fixes the cascading-line problem in xterm.js).
//
// Resize protocol: client sends a 5-byte binary message [0x00, ch, cl, rh, rl]
// where cols = (ch<<8)|cl and rows = (rh<<8)|rl.  The Python bridge calls
// TIOCSWINSZ + SIGWINCH when it sees this prefix byte.
function attachTerminalWss(wss) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const instance = url.searchParams.get('instance');
    const cols = Math.max(20, parseInt(url.searchParams.get('cols') || '220', 10));
    const rows = Math.max(5,  parseInt(url.searchParams.get('rows') || '50',  10));

    if (!instance) {
      ws.close(1008, 'instance query param required');
      return;
    }

    // Python PTY bridge — written verbatim to a temp file via heredoc, then
    // exec'd.  Single-space indentation is valid Python 3.
    // IMPORTANT: keep this a plain string (not a template literal) until the
    // ROWS/COLS substitution below so that ${...} inside Python code is safe.
    const pyBridge = `import sys,os,pty,fcntl,struct,signal,select,termios
mfd,sfd=pty.openpty()
fcntl.ioctl(sfd,termios.TIOCSWINSZ,struct.pack("HHHH",TMROWS,TMCOLS,0,0))
pid=os.fork()
if pid==0:
 os.setsid()
 try:fcntl.ioctl(sfd,termios.TIOCSCTTY,0)
 except:pass
 for f in[0,1,2]:os.dup2(sfd,f)
 if sfd>2:os.close(sfd)
 os.close(mfd)
 os.execvp("/bin/bash",["/bin/bash","-l","-i"])
os.close(sfd)
while True:
 try:r,_,_=select.select([0,mfd],[],[],1)
 except:r=[]
 if 0 in r:
  try:chunk=os.read(0,4096)
  except:break
  if not chunk:break
  i=0
  while i<len(chunk):
   if chunk[i:i+1]==b'\\x00':
    if i+5<=len(chunk):
     c=(chunk[i+1]<<8)|chunk[i+2];rr=(chunk[i+3]<<8)|chunk[i+4]
     fcntl.ioctl(mfd,termios.TIOCSWINSZ,struct.pack("HHHH",rr,c,0,0))
     os.kill(pid,signal.SIGWINCH);i+=5
    else:i=len(chunk)
   else:
    e=chunk.find(b'\\x00',i)
    tw=chunk[i:] if e<0 else chunk[i:e]
    if tw:os.write(mfd,tw)
    i=len(chunk) if e<0 else e
 if mfd in r:
  try:d=os.read(mfd,4096)
  except:break
  if not d:break
  os.write(1,d)
try:os.waitpid(pid,0)
except:pass`
      .replace('TMROWS', String(rows))
      .replace('TMCOLS', String(cols));

    // Spawn a login bash in WSL, write the bridge script via heredoc, then exec
    // python3 to replace bash.  stdin stays open so Python uses it as terminal I/O.
    const child = spawn('wsl.exe', ['-d', instance, 'bash', '-l'], {
      windowsHide: true,
    });

    child.stdin.write(
      `cat > /tmp/dmt_pty_$$.py << 'DMTPYEND'\n${pyBridge}\nDMTPYEND\nexec python3 /tmp/dmt_pty_$$.py\n`
    );

    const fwd = (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data instanceof Buffer ? data : Buffer.from(data));
    };

    child.stdout.on('data', fwd);
    child.stderr.on('data', fwd);
    child.on('close', () => { try { ws.close(); } catch {} });
    child.on('error', (err) => { try { ws.close(1011, err.message); } catch {} });

    ws.on('message', (data) => { try { child.stdin.write(data); } catch {} });
    ws.on('close', () => { try { child.kill(); } catch {} });
  });
}

module.exports = router;
module.exports.attachTerminalWss = attachTerminalWss;
