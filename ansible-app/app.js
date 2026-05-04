const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const process = require('process');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { cwd } = require('process');
const yaml = require('js-yaml');
const GuacamoleLite = require('guacamole-lite');

const execPromise = promisify(exec);

// We need to save a ref to the guac server
// so our SIGINT clean up will work.
var guacServer = null;

process.on('uncaughtException', err => {
  console.error('[DMT] Uncaught exception (kept alive):', err.message);
});
process.on('unhandledRejection', reason => {
  console.error('[DMT] Unhandled rejection (kept alive):', reason);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');

  if (guacServer) {
    try {
      guacServer.close();
    } catch (e) {
      console.error('Error closing guacServer:', e);
    }
  }

  httpServer.close(() => {
    console.log('HTTP server closed');
    // ✅ NOW it's safe to exit
    process.exit(0);
  });
});

const ansiblePlaybookPath = '/home/.ansiblevenv/bin/ansible-playbook';
const DEFAULT_REPO_FOLDER = '/home/ansibleapp/repo';

// Config lives in the user's home dir so it survives a "Sync to WSL" that
// overwrites the ansible-app directory. Migrate from the legacy location once.
const configPath = path.join(process.env.HOME || '/root', '.dmttools-config.json');
const connectionsPath = path.join(process.env.HOME || '/root', '.dmttools-connections.json');
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

// ── Guacamole token encryption ─────────────────────────────────────────────────
// guacamole-lite's Crypt.decrypt decodes the IV with Buffer.from(b64,'base64').toString('ascii'),
// which strips bit 7 from any byte >= 128.  We must pre-strip the IV before encrypting
// so the ASCII round-trip inside Crypt.decrypt is lossless and the IV matches.
// NOTE: do NOT use Crypt.encrypt — its encrypt() stores the raw unstripped IV but
// decrypt() strips it, so the two methods are internally inconsistent.

let _guacKey = null;
function getGuacKey() {
  if (!_guacKey) {
    // Hex-encode first 16 bytes → 32 ASCII hex chars (0-9/a-f).
    // All chars are < 128, so guacamole-lite's ASCII round-trip is lossless for the key.
    _guacKey = getMachineKey().slice(0, 16).toString('hex');
  }
  return _guacKey;
}

function generateGuacToken(type, settings) {
  const payload = JSON.stringify({ connection: { type, settings } });
  // Strip bit 7 from each IV byte so the value survives Crypt.decrypt's .toString('ascii').
  const iv = Buffer.from(crypto.randomBytes(16).map(b => b & 0x7f));
  const cipher = crypto.createCipheriv('aes-256-cbc', getGuacKey(), iv);
  let value = cipher.update(payload, 'utf8', 'binary');
  value += cipher.final('binary');
  const inner = JSON.stringify({
    iv:    Buffer.from(iv).toString('base64'),
    value: Buffer.from(value, 'binary').toString('base64'),
  });
  return Buffer.from(inner).toString('base64');
}

function defaultGuacPort(type) {
  return type === 'rdp' ? '3389' : type === 'vnc' ? '5900' : '22';
}

// ── Remote connections storage ────────────────────────────────────────────────

function readConnections() {
  try {
    const data = JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'));
    return Array.isArray(data.connections) ? data.connections : [];
  } catch {
    return [];
  }
}

function writeConnections(connections) {
  fs.writeFileSync(connectionsPath, JSON.stringify({ connections }, null, 2), 'utf-8');
}

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
  const ansibleConfig = req.body.ansibleConfig || '';

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
        ANSIBLE_CONFIG: ansibleConfig,
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
  const includeFiles = req.query.files === '1';
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    const parent = dirPath === '/' ? null : path.dirname(dirPath);
    const stat = fs.statSync(dirPath);
    const result = { path: dirPath, parent, dirs, worldWritable: !!(stat.mode & 0o002) };
    if (includeFiles) {
      result.files = entries
        .filter(e => e.isFile())
        .map(e => e.name)
        .sort((a, b) => a.localeCompare(b));
    }
    res.json(result);
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

// Custom snippets file path
app.get('/config/custom-snippets', (req, res) => {
  const config = readConfig();
  res.json({ path: config.customSnippetsPath || '' });
});

app.post('/config/custom-snippets', (req, res) => {
  const { path: snippetsPath } = req.body;
  const config = readConfig();
  config.customSnippetsPath = snippetsPath || '';
  writeConfig(config);
  res.json({ ok: true });
});

// Read and return the custom snippets array from the configured YAML file.
// Returns [] silently on any error so App.jsx doesn't need error handling.
app.get('/config/snippets', (req, res) => {
  const config = readConfig();
  const filePath = config.customSnippetsPath || '';
  if (!filePath) return res.json([]);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw);
    if (!Array.isArray(parsed)) return res.json([]);
    const valid = parsed.filter(x => x && typeof x.name === 'string' && typeof x.snippet === 'string');
    res.json(valid);
  } catch {
    res.json([]);
  }
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

// ── Remote Desktop connection manager ─────────────────────────────────────────

app.get('/guacd-status', async (req, res) => {
  try {
    await execPromise('pgrep guacd', { shell: '/bin/bash' });
    res.json({ running: true });
  } catch {
    res.json({ running: false });
  }
});

// Diagnostic endpoint — tests crypto round-trip and guacd reachability
app.get('/test-guac', async (req, res) => {
  const result = { keyLength: getGuacKey().length, guacdRunning: false, cryptoOk: false, error: null };

  try {
    await execPromise('pgrep guacd', { shell: '/bin/bash' });
    result.guacdRunning = true;
  } catch { /* not running */ }

  try {
    const token = generateGuacToken('rdp', { hostname: '127.0.0.1', port: '3389' });
    // Simulate exactly what ClientConnection.decryptToken does:
    // base64decode outer → parse JSON → base64decode iv with 'ascii' → decrypt
    const tokenData = JSON.parse(Buffer.from(token, 'base64').toString('ascii'));
    const ivStr = Buffer.from(tokenData.iv, 'base64').toString('ascii');
    const valBuf = Buffer.from(tokenData.value, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', getGuacKey(), ivStr);
    let dec = decipher.update(valBuf.toString('binary'), 'binary', 'ascii');
    dec += decipher.final('ascii');
    const parsed = JSON.parse(dec);
    result.cryptoOk = true;
    result.decryptedType = parsed?.connection?.type;
  } catch (err) {
    result.error = err.message;
  }

  // Check guacd version and installed plugins
  try {
    const { stdout: ver } = await execPromise(
      'dpkg -l guacd 2>/dev/null | grep "^ii" | awk \'{print $3}\'',
      { shell: '/bin/bash' }
    );
    result.guacdVersion = ver.trim() || 'unknown';
  } catch { result.guacdVersion = 'unknown'; }
  try {
    const { stdout: rdp } = await execPromise(
      'find /usr/lib -name "libguac-client-rdp.so*" 2>/dev/null | head -1',
      { shell: '/bin/bash' }
    );
    result.rdpPlugin = rdp.trim() || 'not found';
  } catch { result.rdpPlugin = 'unknown'; }

  res.json(result);
});

// Last N lines of guacd debug log
app.get('/guac-logs', async (req, res) => {
  try {
    const { stdout } = await execPromise('tail -60 /tmp/guacd.log 2>/dev/null || echo "(log empty — restart DMT Tools to begin capturing)"', { shell: '/bin/bash' });
    res.type('text/plain').send(stdout);
  } catch {
    res.type('text/plain').send('(log not available)');
  }
});

// TCP reachability test — lets the UI confirm a host:port is reachable from inside WSL
app.post('/test-connectivity', (req, res) => {
  const { host, port } = req.body;
  if (!host || !port) return res.status(400).json({ error: 'host and port required' });
  const net = require('net');
  const socket = net.createConnection({ host, port: parseInt(port, 10), timeout: 3000 });
  socket.once('connect', () => { socket.destroy(); res.json({ reachable: true }); });
  socket.once('timeout', () => { socket.destroy(); res.json({ reachable: false, reason: 'Timed out — host unreachable or port filtered' }); });
  socket.once('error', err => res.json({ reachable: false, reason: err.message }));
});

app.get('/remote-connections', (req, res) => {
  const connections = readConnections();
  res.json(connections.map(c => ({ ...c, hasPassword: !!c.password, password: undefined })));
});

app.post('/remote-connections', (req, res) => {
  const { id, name, type, host, port: connPort, username, password, domain, dpi, security } = req.body;
  if (!name || !type || !host) return res.status(400).json({ error: 'name, type, and host are required' });

  const connections = readConnections();
  const encPassword = password ? encryptToken(password) : undefined;
  const resolvedPort = connPort || defaultGuacPort(type);

  if (id) {
    const idx = connections.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Connection not found' });
    connections[idx] = {
      ...connections[idx],
      name, type, host,
      port: resolvedPort,
      username: username || '',
      ...(domain !== undefined ? { domain } : {}),
      ...(encPassword !== undefined ? { password: encPassword } : {}),
      //...(dpi ? { dpi } : {}),
      security: security || 'any',
    };
  } else {
    connections.push({
      id: crypto.randomUUID(),
      name, type, host,
      port: resolvedPort,
      username: username || '',
      ...(domain ? { domain } : {}),
      ...(encPassword ? { password: encPassword } : {}),
      //...(dpi ? { dpi } : {}),
      security: security || 'any',
    });
  }

  writeConnections(connections);
  res.json({ ok: true });
});

app.delete('/remote-connections/:id', (req, res) => {
  const updated = readConnections().filter(c => c.id !== req.params.id);
  writeConnections(updated);
  res.json({ ok: true });
});

app.post('/remote-connect', (req, res) => {
  const { id, host, type, port: connPort, username, password, domain, width, height, dpi, security } = req.body;

  let connType, settings;

  if (id) {
    const conn = readConnections().find(c => c.id === id);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });
    connType = conn.type;
    const storedPass = conn.password ? decryptToken(conn.password) : '';
    settings = buildGuacSettings(conn.type, {
      host: conn.host, port: conn.port,
      username: conn.username || '', password: password || storedPass,
      domain: conn.domain || '',
      width: width || '1920', height: height || '1080',
      //dpi: dpi || conn.dpi || '',
      security: conn.security || 'any',
    });
  } else {
    if (!host || !type) return res.status(400).json({ error: 'host and type are required' });
    connType = type;
    settings = buildGuacSettings(type, {
      host, port: connPort || defaultGuacPort(type),
      username: username || '', password: password || '',
      domain: domain || '', width: width || '1920', height: height || '1080',
      //dpi: dpi || '',
      security: security || 'any',
    });
  }

  res.json({ token: generateGuacToken(connType, settings) });
});

function buildGuacSettings(type, { host, port, username, password, domain, width, height, dpi, security }) {
  const base = { hostname: host, port: String(port || defaultGuacPort(type)) };
  if (type === 'rdp') {
    return {
      ...base,
      username, password,
      ...(domain ? { domain } : {}),
      width: String(width || '1920'),
      height: String(height || '1080'),
      //...(dpi ? { dpi: String(dpi) } : {}),
      'color-depth': '32',
      'ignore-cert': 'true',
      security: security || 'any',
      'resize-method': 'display-update',
    };
  }
  if (type === 'vnc') {
    return {
      ...base,
      password,
      width: String(width || '1920'),
      height: String(height || '1080'),
      'color-depth': '24',
      encodings: 'tight zrle ultra copyrect hextile zlib corre rre raw',
    };
  }
  // ssh
  return {
    ...base,
    username, password,
    'terminal-type': 'xterm-256color',
    'color-scheme': 'white-black',
    'font-name': 'monospace',
    'font-size': '14',
  };
}

// ── Catch-all ──────────────────────────────────────────────────────────────────

app.get('/*name', (req, res) => {
  // SPA fallback handled by static middleware above
});

const httpServer = http.createServer(app);

guacServer = new GuacamoleLite(
  { server: httpServer },
  { host: '127.0.0.1', port: 4822 },
  {
    crypt: {
      cypher: 'AES-256-CBC',
      key: getGuacKey(), // 32 ASCII hex chars; Node.js crypto uses binary/latin1 for strings = 32 bytes = AES-256 key
    },
    log: { level: 'VERBOSE' },
  }
);

httpServer.listen(port, '127.0.0.1', () => {
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
