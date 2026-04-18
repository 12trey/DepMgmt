const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const process = require('process');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { cwd } = require('process');

const execPromise = promisify(exec);

const ansiblePlaybookPath = '/home/.ansiblevenv/bin/ansible-playbook';
const repoFolder = '/home/ansibleapp/repo';
const configPath = path.join(__dirname, 'appconfig.json');

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

// ── Ansible playbook execution ─────────────────────────────────────────────────

var isRunning = false;

app.post('/runplay', async (req, res) => {
  isRunning = true;

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

// ── File browser ───────────────────────────────────────────────────────────────

app.post('/files', async (req, res) => {
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
  let cmd = `cat .${req.body.file}`;
  const { stdout } = await execPromise(cmd, { shell: '/bin/bash', cwd: repoFolder });
  res.json({ content: objuscate(stdout) });
});

app.post('/savefile', async (req, res) => {
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

app.post('/renamefile', (req, res) => {
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

// ── Git operations ─────────────────────────────────────────────────────────────

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(data) {
  fs.writeFileSync(configPath, JSON.stringify(data, null, 4), 'utf-8');
}

app.get('/git/config', (req, res) => {
  const config = readConfig();
  res.json({ repoUrl: config.ansibleRepoUrl || '' });
});

app.post('/git/config', (req, res) => {
  const { repoUrl } = req.body;
  if (repoUrl === undefined) return res.status(400).json({ error: 'repoUrl required' });
  const config = readConfig();
  config.ansibleRepoUrl = repoUrl;
  writeConfig(config);
  res.json({ ok: true });
});

app.post('/git/clone', async (req, res) => {
  const config = readConfig();
  const repoUrl = config.ansibleRepoUrl;
  if (!repoUrl) return res.status(400).json({ error: 'No repo URL configured. Set it first.' });

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

    const proc = spawn('git', ['clone', repoUrl, repoFolder], {
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
  try {
    await execPromise(`git -C "${repoFolder}" add -A`, { shell: '/bin/bash' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/git/commit', async (req, res) => {
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
  try {
    const { stdout, stderr } = await execPromise(
      `git -C "${repoFolder}" push`,
      { shell: '/bin/bash' }
    );
    res.json({ ok: true, output: stdout + stderr });
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

// ── Catch-all ──────────────────────────────────────────────────────────────────

app.get('/*name', (req, res) => {
  // SPA fallback handled by static middleware above
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 dmttools listening on http://localhost:${port} 🌐`);
  console.log('Press Ctrl+C to stop the server.');
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function objuscate(text) {
  return text.replace(/password=(.*?)(?=\s|,|$)/gi, 'Password=******');
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
