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

    // Check node — try login shell PATH first, then scan NVM directory tree
    try {
      const nvmNode = [
        'export NVM_DIR="$HOME/.nvm"',
        '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
        // If still not found, locate node binary directly inside NVM versions
        'NODE_BIN=$(command -v node 2>/dev/null)',
        'if [ -z "$NODE_BIN" ]; then',
        '  NODE_BIN=$(find "$NVM_DIR/versions/node" -maxdepth 2 -name node -type f 2>/dev/null | sort -V | tail -1)',
        'fi',
        '[ -n "$NODE_BIN" ] && "$NODE_BIN" --version',
      ].join('\n');
      const r = await wslExec(instance, nvmNode);
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
// Body: { instance }
router.post('/setup', (req, res) => {
  const { instance } = req.body;
  if (!instance) return res.status(400).json({ error: 'instance is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  // Build the script as a plain string and pipe it via stdin.
  // Passing a large multi-line script as a -c argument through Windows spawn
  // mangles double-quote assignments (e.g. VAR="value" arrives as VAR=).
  const setupScript = `
set -e

# Set the desired timezone for configuration files
TIMEZONE="America/New_York"
# Define the Kerberos Realm and KDC details
KERB_REALM="CORP.AD.SENTARA.COM"
KDC_SERVER="corpadsen01-ind.corp.ad.sentara.com"

# Set timezone
if [ -f /etc/timezone ]; then
    echo "    [INFO] Setting timezone to $TIMEZONE..."
    sudo sh -c "echo $TIMEZONE > /etc/timezone"
else
    echo "    [WARN] Could not find /etc/timezone, skipping timezone setup."
fi

# Set krb5.conf
KRB5_CONF_CONTENT=$(cat <<EOF
[libdefaults]
    default_realm = \${KERB_REALM}

# The following krb5.conf variables are only for MIT Kerberos.
    kdc_timesync = 1
    ccache_type = 4
    forwardable = true
    proxiable = true
    rdns = false


# The following libdefaults parameters are only for Heimdal Kerberos.
    fcc-mit-ticketflags = true

[realms]
    \${KERB_REALM} = {
            kdc = \${KDC_SERVER}
            admin_server = \${KDC_SERVER}
            default_domain = corp.ad.sentara.com
    }

[domain_realm]
    .corp.ad.sentara.com = \${KERB_REALM}
    corp.ad.sentara.com = \${KERB_REALM}
EOF
)
if ! grep -q "default_realm = \${KERB_REALM}" /etc/krb5.conf; then
    echo "    [INFO] Configuring /etc/krb5.conf..."
    echo "$KRB5_CONF_CONTENT" | sudo tee /etc/krb5.conf > /dev/null
else
    echo "    [INFO] /etc/krb5.conf appears correctly configured. Skipping write."
fi

export DEBIAN_FRONTEND=noninteractive

# Use only the standard Linux PATH so WSL does not pick up Windows binaries
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Source NVM early so any existing node install is visible
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

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

echo "==> Checking for NVM/Node..."
if ! command -v node > /dev/null 2>&1; then
  echo "==> Installing NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  echo "==> Installing Node.js..."
  nvm install node
  nvm alias default node
  nvm use default
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

echo "==> Setup complete!"
`;

  // Pipe script via stdin — avoids Windows argument-quoting issues entirely
  const args = ['-d', instance, 'bash', '-l'];
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
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if ! command -v node > /dev/null 2>&1; then
  NODE_BIN=$(find "$NVM_DIR/versions/node" -maxdepth 2 -name node -type f 2>/dev/null | sort -V | tail -1)
  [ -n "$NODE_BIN" ] && export PATH="$(dirname "$NODE_BIN"):$PATH"
fi
cd ${APP_PATH}
exec node ${APP_ENTRY} >> /tmp/dmt-app.log 2>&1
EOLAUNCH
chmod +x /tmp/dmt-launch.sh
`);

    // Spawn wsl.exe running bash in the foreground (node runs via exec, keeping wsl.exe alive).
    // windowsHide:true works for non-detached processes — confirmed working by the setup spawn.
    // unref() lets the Express server continue without waiting for this child to exit.
    const child = spawn('wsl.exe', ['-d', instance, 'bash', '-l', '/tmp/dmt-launch.sh'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    res.json({ launched: true, instance, port: APP_PORT });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/wsl/sync — rsync ansible-app/ from the Windows project into the WSL instance
// Body: { instance }
router.post('/sync', async (req, res) => {
  const { instance } = req.body;
  if (!instance) return res.status(400).json({ error: 'instance is required' });

  try {
    const result = await wslExec(instance, `
rsync -av --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='my-react-app/node_modules' \
  --exclude='my-react-app/dist' \
  "${ANSIBLE_APP_WSL}/" "${APP_PATH}/"
`);
    res.json({ synced: true, output: result.stdout });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
