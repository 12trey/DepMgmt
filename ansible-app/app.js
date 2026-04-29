const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const process = require('process');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { cwd } = require('process');

const execPromise = promisify(exec);

const ansiblePlaybookPath = '/home/.ansiblevenv/bin/ansible-playbook';
const DEFAULT_REPO_FOLDER = '/home/ansibleapp/repo';

// Config lives in the user's home dir so it survives a "Sync to WSL" that
// overwrites the ansible-app directory. Migrate from the legacy location once.
const configPath = path.join(process.env.HOME || '/root', '.dmttools-config.json');
const legacyConfigPath = path.join(__dirname, 'appconfig.json');
if (!fs.existsSync(configPath) && fs.existsSync(legacyConfigPath)) {
  try { fs.copyFileSync(legacyConfigPath, configPath); } catch { /* ignore */ }
}

function getRepoFolder() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return c.repoFolder || DEFAULT_REPO_FOLDER;
  } catch {
    return DEFAULT_REPO_FOLDER;
  }
}

const port = 7000;

const app = express();
app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'clipboard-write=(self)');
  next();
});

app.use(express.static(path.join(__dirname, 'my-react-app/dist')));

app.get('/winendpoints.ps1', (req, res) => {
  const filePath = path.join(__dirname, 'winendpoints.ps1');
  res.download(filePath, 'winendpoints.ps1', (err) => {
    if (err) {
      console.error('File download failed:', err);
      res.status(404).send('File not found.');
    }
  });
});

app.get('/vscode-status', (req, res) => {
  exec('which code', (err) => {
    res.json({ available: !err });
  });
});

app.post('/codedot', (req, res) => {
  const codeproc = spawn('code', ['.'], {
    cwd: getRepoFolder()
  });

  res.status(200).json({ msg: "ran code ." });
});

// ── Ansible playbook execution ─────────────────────────────────────────────────

var isRunning = false;

app.post('/runplay', async (req, res) => {
  isRunning = true;
  const repoFolder = getRepoFolder();

  let inifile = req.body.ini ? `.${req.body.ini}` : '';
  let yamlfile = req.body.yaml ? `.${req.body.yaml}` : '';

  if (!inifile || !yamlfile) {
    res.json({ msg: 'Please provide both ini and yaml files.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const proc = spawn(
    'ansible-playbook',
    ['-i', inifile, yamlfile, '-vvvvv'],
    {
      shell: false,
      cwd: repoFolder,
      env: {
        ...process.env,
        ANSIBLE_CONFIG: '',
        ANSIBLE_STDOUT_CALLBACK: 'ansible.posix.json',
        ANSIBLE_DEPRECATION_WARNINGS: 'False',
        ANSIBLE_COMMAND_WARNINGS: 'False',
        ANSIBLE_ACTION_WARNINGS: 'False',
        ANSIBLE_SYSTEM_WARNINGS: 'False',
        ANSIBLE_CALLBACK_PLUGINS: '/home/ansibleapp/callback_plugins',
        ANSIBLE_CALLBAKS_ENABLED: 'cmtrace'
      },
    }
  );

  let output = '';
  let errorOutput = '';

  proc.stdout.on('data', (data) => {
    output += data.toString();
    res.write(`${data.toString()}\n`);
  });

  proc.stderr.on('data', (data) => {
    errorOutput += data.toString();
    res.write(`ERROR: ${data.toString()}\n`);
  });

  proc.on('error', (err) => {
    console.error(`Failed to start process: ${err}`);
    res.write(`ERROR: Failed to start process: ${err}\n`);
    res.end();
  });

  proc.on('close', (code) => {
    console.log(`Process exited with code ${code}`);
    let jsons = extractJSON(output);
    res.write(`Process exited with code ${code}\n`);
    res.write(JSON.stringify({ msg: jsons, error: errorOutput }));
    res.end();
    isRunning = false;
  });

  res.on('close', () => {
    proc.kill();
    isRunning = false;
  });
});

app.get('/isrunning', (req, res) => {
  res.json({ isRunning });
});

// ── CMTrace log export ─────────────────────────────────────────────────────────
// Serves /tmp/ansible_cmtrace.log content (or a byte-range slice via ?offset=N)
// so the Log Viewer in aipsadt can poll for new lines without file-system access.
app.get('/logs/cmtrace', (req, res) => {
  const logPath = '/tmp/ansible_cmtrace.log';
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  if (!fs.existsSync(logPath)) {
    return res.type('text/plain').send('');
  }

  try {
    const stat = fs.statSync(logPath);
    if (offset >= stat.size) {
      return res.type('text/plain').send('');
    }
    res.type('text/plain');
    fs.createReadStream(logPath, { start: offset, encoding: 'utf8' }).pipe(res);
  } catch (err) {
    res.status(500).type('text/plain').send('');
  }
});

// ── File browser ───────────────────────────────────────────────────────────────

app.post('/files', async (req, res) => {
  const repoFolder = getRepoFolder();
  // Use explicit cwd option instead of process.chdir() — chdir mutates global
  // process state and causes downstream failures (e.g. git clone after rm -rf).
  const execOpts = { shell: '/bin/bash', cwd: repoFolder };
  let returndata = { files: [], folders: [], cwd: `${req.body.folder}` };

  let cmd = `find .${req.body.folder} -maxdepth 1 -type f -regex '.*\\.\\(yaml\\|yml\\|ini\\)' | jq -Rr '"\\"" + .[2:] + "\\""' | jq -s`;
  const { stdout: sout } = await execPromise(cmd, execOpts);

  let cmd2 = `find .${req.body.folder} -maxdepth 1 -type d | jq -Rr '"\\"" + .[2:] + "\\""' | jq -s`;
  const { stdout: fout } = await execPromise(cmd2, execOpts);

  if (sout) returndata.files = JSON.parse(sout);
  if (fout) {
    returndata.folders = JSON.parse(fout);
    returndata.folders.splice(0, 1);
  }
  res.json(returndata);
});

app.post('/getfilecontent', async (req, res) => {
  const repoFolder = getRepoFolder();
  let cmd = `cat .${req.body.file}`;
  const { stdout } = await execPromise(cmd, { shell: '/bin/bash', cwd: repoFolder });
  res.json({ content: objuscate(stdout) });
});

app.post('/savefile', async (req, res) => {
  const repoFolder = getRepoFolder();
  const { file, content } = req.body;
  if (!file || content === undefined) {
    return res.status(400).json({ error: 'file and content are required' });
  }
  // Resolve to absolute path and verify it stays inside repoFolder
  const fullPath = path.resolve(repoFolder, '.' + file);
  if (!fullPath.startsWith(repoFolder + '/') && fullPath !== repoFolder) {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/mkdir', (req, res) => {
  const repoFolder = getRepoFolder();
  const { dir } = req.body;
  if (!dir) return res.status(400).json({ error: 'dir is required' });
  const fullPath = path.resolve(repoFolder, '.' + dir);
  if (!fullPath.startsWith(repoFolder + '/') && fullPath !== repoFolder)
    return res.status(400).json({ error: 'Invalid directory path' });
  try {
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/renamefile', (req, res) => {
  const repoFolder = getRepoFolder();
  const { file, newName } = req.body;
  if (!file || !newName) return res.status(400).json({ error: 'file and newName are required' });
  const oldPath = path.resolve(repoFolder, '.' + file);
  if (!oldPath.startsWith(repoFolder + '/') && oldPath !== repoFolder)
    return res.status(400).json({ error: 'Invalid file path' });
  // Build new path: same directory, new name
  const newPath = path.join(path.dirname(oldPath), path.basename(newName));
  if (!newPath.startsWith(repoFolder + '/'))
    return res.status(400).json({ error: 'Invalid new name' });
  try {
    fs.renameSync(oldPath, newPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/deletefile', (req, res) => {
  const repoFolder = getRepoFolder();
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'file is required' });
  const fullPath = path.resolve(repoFolder, '.' + file);
  if (!fullPath.startsWith(repoFolder + '/') && fullPath !== repoFolder)
    return res.status(400).json({ error: 'Invalid file path' });
  try {
    fs.unlinkSync(fullPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Credential encryption ──────────────────────────────────────────────────────
// Derives a 32-byte AES-256 key from the WSL machine-id so that the token is
// bound to this specific machine. Falls back to a fixed salt if machine-id is
// unreadable (e.g. first boot), but the same salt will always produce the same
// key on the same machine as long as /etc/machine-id doesn't change.

const MACHINE_ID_PATH = '/etc/machine-id';
const ENC_PREFIX = 'enc:';

function getMachineKey() {
  let machineId;
  try {
    machineId = fs.readFileSync(MACHINE_ID_PATH, 'utf-8').trim();
  } catch {
    machineId = 'fallback-machine-id';
  }
  // scryptSync: cost N=2^15, r=8, p=1 — fast enough for startup, strong enough for at-rest storage
  return crypto.scryptSync(machineId, 'ansible-app-salt', 32);
}

function encryptToken(plaintext) {
  const key = getMachineKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: enc:<iv_hex>:<authTag_hex>:<ciphertext_hex>
  return `${ENC_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptToken(stored) {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext — return as-is
  const parts = stored.slice(ENC_PREFIX.length).split(':');
  if (parts.length !== 3) return stored;
  const [ivHex, authTagHex, ciphertextHex] = parts;
  try {
    const key = getMachineKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return decipher.update(Buffer.from(ciphertextHex, 'hex'), undefined, 'utf-8') + decipher.final('utf-8');
  } catch {
    return ''; // tampered or unreadable — treat as missing
  }
}

// ── Git operations ─────────────────────────────────────────────────────────────

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    // Transparently decrypt token on read; if it was plaintext, re-encrypt and save.
    if (raw.gitToken && !raw.gitToken.startsWith(ENC_PREFIX)) {
      raw.gitToken = raw.gitToken; // keep in memory as plaintext for this call
      const migrated = { ...raw, gitToken: encryptToken(raw.gitToken) };
      fs.writeFileSync(configPath, JSON.stringify(migrated, null, 4), 'utf-8');
    } else if (raw.gitToken) {
      raw.gitToken = decryptToken(raw.gitToken);
    }
    return raw;
  } catch {
    return {};
  }
}

function writeConfig(data) {
  const toWrite = { ...data };
  if (toWrite.gitToken) {
    toWrite.gitToken = encryptToken(toWrite.gitToken);
  }
  fs.writeFileSync(configPath, JSON.stringify(toWrite, null, 4), 'utf-8');
}

app.get('/git/config', (req, res) => {
  const config = readConfig();
  res.json({
    repoUrl: config.ansibleRepoUrl || '',
    gitUsername: config.gitUsername || '',
    gitToken: config.gitToken || '',
  });
});

app.post('/git/config', (req, res) => {
  const { repoUrl, gitUsername, gitToken } = req.body;
  if (repoUrl === undefined) return res.status(400).json({ error: 'repoUrl required' });
  const config = readConfig();
  config.ansibleRepoUrl = repoUrl;
  if (gitUsername !== undefined) config.gitUsername = gitUsername;
  if (gitToken !== undefined) config.gitToken = gitToken;
  writeConfig(config);
  res.json({ ok: true });
});

// Inject credentials into an HTTPS repo URL without modifying the stored remote.
// The URL API setter handles percent-encoding automatically — do NOT pre-encode.
function buildAuthUrl(repoUrl, username, token) {
  if (!username && !token) return repoUrl;
  try {
    const u = new URL(repoUrl);
    if (username) u.username = username;
    if (token)    u.password = token;
    return u.toString();
  } catch {
    return repoUrl;
  }
}

app.post('/git/clone', async (req, res) => {
  const repoFolder = getRepoFolder();
  const config = readConfig();
  const repoUrl = config.ansibleRepoUrl;
  if (!repoUrl) return res.status(400).json({ error: 'No repo URL configured. Set it first.' });

  const cloneUrl = buildAuthUrl(repoUrl, config.gitUsername, config.gitToken);

  // Stream output via SSE so the frontend can show progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // Remove existing repo — use an explicit cwd so we don't delete our own cwd.
    await execPromise(`rm -rf "${repoFolder}"`, { shell: '/bin/bash', cwd: '/tmp' });
    send({ type: 'stdout', line: `Cloning ${repoUrl} into ${repoFolder}…` });

    // Ensure parent directory exists before cloning into it.
    await execPromise(`mkdir -p "${path.dirname(repoFolder)}"`, { shell: '/bin/bash', cwd: '/tmp' });

    const proc = spawn('git', ['clone', cloneUrl, repoFolder], {
      shell: false,
      cwd: path.dirname(repoFolder), // /home/ansibleapp — always exists
    });
    proc.stdout.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => send({ type: 'stdout', line: l })));
    proc.stderr.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => send({ type: 'stdout', line: l })));
    proc.on('close', (code) => {
      if (code === 0) {
        send({ type: 'exit', code, ok: true });
      } else {
        send({ type: 'exit', code, ok: false, error: `git clone exited with code ${code}` });
      }
      res.end();
    });
    proc.on('error', (err) => {
      send({ type: 'exit', code: -1, ok: false, error: err.message });
      res.end();
    });
  } catch (err) {
    send({ type: 'exit', code: -1, ok: false, error: err.message });
    res.end();
  }
});

app.get('/git/status', async (req, res) => {
  const repoFolder = getRepoFolder();
  try {
    const { stdout } = await execPromise(
      `git -C "${repoFolder}" status --porcelain=v1`,
      { shell: '/bin/bash' }
    );
    const files = stdout.trim().split('\n').filter(Boolean).map(line => ({
      status: line.slice(0, 2).trim(),
      file: line.slice(3),
    }));
    // Also get current branch
    const { stdout: branch } = await execPromise(
      `git -C "${repoFolder}" rev-parse --abbrev-ref HEAD`,
      { shell: '/bin/bash' }
    );
    res.json({ files, branch: branch.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/git/stage', async (req, res) => {
  const repoFolder = getRepoFolder();
  try {
    await execPromise(`git -C "${repoFolder}" add -A`, { shell: '/bin/bash' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/git/commit', async (req, res) => {
  const repoFolder = getRepoFolder();
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Commit message is required' });
  try {
    const { stdout } = await execPromise(
      `git -C "${repoFolder}" commit -m ${JSON.stringify(message)}`,
      { shell: '/bin/bash' }
    );
    res.json({ ok: true, output: stdout });
  } catch (err) {
    // git commit exits non-zero if there's nothing to commit
    res.status(500).json({ error: err.message });
  }
});

app.post('/git/push', async (req, res) => {
  const repoFolder = getRepoFolder();
  try {
    const config = readConfig();
    const pushUrl = buildAuthUrl(
      config.ansibleRepoUrl || '',
      config.gitUsername,
      config.gitToken
    );
    // Spawn directly (no shell) so credentials in the URL are not visible in shell history.
    await new Promise((resolve, reject) => {
      const args = ['-C', repoFolder, 'push'];
      if (pushUrl) args.push(pushUrl);
      const proc = spawn('git', args, { shell: false });
      let out = '';
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { out += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve(out);
        else reject(new Error(out.trim() || `git push exited with code ${code}`));
      });
      proc.on('error', reject);
    }).then(output => res.json({ ok: true, output }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Kerberos authentication ────────────────────────────────────────────────────

app.get('/kerberos/status', async (req, res) => {
  try {
    const { stdout } = await execPromise('klist', { shell: '/bin/bash' });
    const principalMatch = stdout.match(/Default principal:\s*(.+)/);
    const principal = principalMatch ? principalMatch[1].trim() : '';
    // Find the TGT expiry line: "MM/DD/YYYY HH:MM:SS  MM/DD/YYYY HH:MM:SS  krbtgt/..."
    let expires = '';
    for (const line of stdout.split('\n')) {
      const m = line.match(/\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}\s+(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})\s+krbtgt\//);
      if (m) { expires = m[1].trim(); break; }
    }
    res.json({ valid: true, principal, expires });
  } catch {
    res.json({ valid: false, principal: '', expires: '' });
  }
});

// kinit reads the password from stdin when stdin is not a TTY (standard MIT Kerberos behaviour).
// We spawn kinit directly and pipe the password to avoid any shell-injection risk.
app.post('/kerberos/init', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  const proc = spawn('kinit', [username], { shell: false });
  let out = '';
  proc.stdout.on('data', d => { out += d.toString(); });
  proc.stderr.on('data', d => { out += d.toString(); });
  proc.on('close', code => {
    if (code === 0) return res.json({ ok: true });
    res.status(401).json({ error: out.trim() || `kinit exited with code ${code}` });
  });
  proc.on('error', err => res.status(500).json({ error: err.message }));
  proc.stdin.write(password + '\n');
  proc.stdin.end();
});

app.post('/kerberos/destroy', async (req, res) => {
  try {
    await execPromise('kdestroy', { shell: '/bin/bash' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Config page endpoints ──────────────────────────────────────────────────────

// Browse WSL filesystem directories for the folder picker
app.get('/browse', (req, res) => {
  const dirPath = req.query.path || '/';
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    const parent = dirPath === '/' ? null : path.dirname(dirPath);
    res.json({ path: dirPath, parent, dirs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get/set the app config (repoFolder, etc.)
app.get('/config/app', (req, res) => {
  const config = readConfig();
  res.json({ repoFolder: config.repoFolder || DEFAULT_REPO_FOLDER });
});

app.post('/config/app', (req, res) => {
  const { repoFolder: folder } = req.body;
  if (!folder) return res.status(400).json({ error: 'repoFolder is required' });
  const config = readConfig();
  config.repoFolder = folder;
  writeConfig(config);
  res.json({ ok: true });
});

// Returns the WSL distro name for this instance (set automatically by WSL)
app.get('/config/instance', (req, res) => {
  res.json({ instance: process.env.WSL_DISTRO_NAME || '' });
});

// Get /etc/krb5.conf as structured form fields (parsed)
app.get('/config/krb5', (req, res) => {
  try {
    const content = fs.readFileSync('/etc/krb5.conf', 'utf-8');
    res.json(parseKrb5(content));
  } catch {
    res.json({ realm: '', kdcServers: [], adminServer: '', defaultDomain: '' });
  }
});

// ── Catch-all ──────────────────────────────────────────────────────────────────

app.get('/*name', (req, res) => {
  // SPA fallback handled by static middleware above
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 dmttools listening on http://localhost:${port} 🌐`);
  console.log('Press Ctrl+C to stop the server.');
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseKrb5(content) {
  const realm       = (content.match(/default_realm\s*=\s*(.+)/)    || [])[1]?.trim() || '';
  const kdcServers  = [...content.matchAll(/^\s*kdc\s*=\s*(.+)/mg)].map(m => m[1].trim());
  const adminServer = (content.match(/admin_server\s*=\s*(.+)/)     || [])[1]?.trim() || '';
  const defaultDomain = (content.match(/default_domain\s*=\s*(.+)/) || [])[1]?.trim() || '';
  return { realm, kdcServers, adminServer, defaultDomain };
}

function objuscate(text) {
  return text.replace(/(password)=(.*?)(?=\s|,|$)/gi, '$1=******');
}

function extractJSON(text) {
  let start = text.indexOf('{');
  while (start !== -1) {
    let end = text.lastIndexOf('}');
    if (end === -1) break;
    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      start = text.indexOf('{', start + 1);
    }
  }
  return null;
}
