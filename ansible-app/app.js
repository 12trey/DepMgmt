const express = require('express');
const cors = require('cors');
const path = require('path');
const process = require('process');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { cwd } = require('process');
const appConfig = require('./appconfig.json');

const ansiblePlaybookPath = '/home/.ansiblevenv/bin/ansible-playbook';

const port = 7000;

const app = express();
app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
  // Set the Permissions-Policy header
  res.set('Permissions-Policy', 'clipboard-write=(self)');
  next();
});

const execPromise = promisify(exec);



// app.get('/', (req, res) => {
//     res.send('Hello World!')
// })


app.use(express.static(path.join(__dirname, 'my-react-app/dist')));

app.get('/winendpoints.ps1', (req, res) => {
  const filePath = path.join(__dirname, 'winendpoints.ps1');
  const fileName = 'winendpoints.ps1'; // Optional: changes name for the user

  res.download(filePath, fileName, (err) => {
    if (err) {
      // Handle errors, such as file not found
      console.error("File download failed:", err);
      res.status(404).send("File not found.");
    }
  });
});

var isRunning = false;

app.post('/runplay', async (req, res) => {
  isRunning = true;

  let inifile = req.body.ini ? `.${req.body.ini}` : "";
  let yamlfile = req.body.yaml ? `.${req.body.yaml}` : "";

  if (!inifile || !yamlfile) {
    res.json({ msg: "Please provide both ini and yaml files." });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let envVars = `ANSIBLE_CONFIG="" ANSIBLE_STDOUT_CALLBACK=ansible.posix.json ANSIBLE_DEPRECATION_WARNINGS=False ANSIBLE_COMMAND_WARNINGS=False ANSIBLE_ACTION_WARNINGS=False ANSIBLE_SYSTEM_WARNINGS=False`;
  let cmd = `${envVars} ansible-playbook -i ${inifile} ${yamlfile} -vvvvv`;

  //const proc = spawn('/bin/bash', ['-c', cmd], { cwd: cwd() });

  const proc = spawn(
  'ansible-playbook',
  ['-i', inifile, yamlfile, '-vvvvv'],
  {
    shell: false, // IMPORTANT: don't use shell
    env: {
      ...process.env,
      ANSIBLE_CONFIG: '',
      ANSIBLE_STDOUT_CALLBACK: 'ansible.posix.json',
      ANSIBLE_DEPRECATION_WARNINGS: 'False',
      ANSIBLE_COMMAND_WARNINGS: 'False',
      ANSIBLE_ACTION_WARNINGS: 'False',
      ANSIBLE_SYSTEM_WARNINGS: 'False',
    }
  }
);

  let output = "";
  let errorOutput = "";

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
    // res.json({ msg: jsons, error: errorOutput });
    res.write(`Process exited with code ${code}\n`);
    res.write(JSON.stringify({ msg: jsons, error: errorOutput }));
    res.end();

    isRunning = false;
  });

  res.on('close', () => {
    proc.kill();
    isRunning = false;
  });

  // try {
  //     const { stdout, stderr } = await execPromise(cmd);
  //     //res.send(`<pre>${stdout}</pre><pre>${stderr}</pre>`);
  //     console.log(`${stdout}`)
  //     let jsons = extractJSON(stdout);
  //     //console.log(`${JSON.stringify(jsons)}`)
  //     //let test = JSON.parse(`${jsons}`);
  //     res.json({ msg: jsons});
  // } catch (error) {
  //     console.error(`Error executing command: ${error}`);
  //     res.json({ msg: `Error executing command: ${error}` });
  // }
})

app.get('/isrunning', (req, res) => {
  res.json({ isRunning });
});

const repoFolder = "/home/ansibleapp/repo";
app.post('/files', async (req, res) => {
  process.chdir(repoFolder);

  console.log(`Repo folder: ${repoFolder}`);
  console.log(req.body);

  let returndata = { files: [], folders: [], cwd: `${req.body.folder}` };

  let cmd = `find .${req.body.folder} -maxdepth 1 -type f -regex '.*\\.\\(yaml\\|yml\\|ini\\)' | jq -Rr '"\\"" + .[2:] + "\\""' | jq -s`;
  const { stdout: sout, stderr: serr } = await execPromise(cmd, { shell: '/bin/bash' });

  let cmd2 = `find .${req.body.folder} -maxdepth 1 -type d | jq -Rr '"\\"" + .[2:] + "\\""' | jq -s`;
  const { stdout: fout, stderr: ferr } = await execPromise(cmd2, { shell: '/bin/bash' });

  // stdout.split('\n').forEach(line => {
  //     if (line.trim() !== '') {
  //         returndata.files.push(line);
  //     }
  // });
  // for(i in returndata.files) {
  //     console.log(`DATA: ${returndata.files[i]}}`);
  // }

  if (sout) {
    returndata.files = JSON.parse(sout);
  }
  if (fout) {
    returndata.folders = JSON.parse(fout);
    returndata.folders.splice(0, 1);
  }
  console.log(returndata.cwd);
  res.json(returndata);
})

app.post('/getfilecontent', async (req, res) => {
  console.log(req.body);
  let cmd = `cat .${req.body.file}`;
  const { stdout, stderr } = await execPromise(cmd, { shell: '/bin/bash' });
  var obfuscated = objuscate(stdout);
  res.json({ content: obfuscated });
});

app.get('/*name', (req, res) => {
  //res.sendFile(path.join(__dirname, 'my-react-app/dist', 'index.html'));
})

app.listen(port, "0.0.0.0", () => {
  console.log(`🌐 dmttools listening on http://localhost:${port} 🌐`)
  console.log("Press Ctrl+C to stop the server.");
})

function maskPasswordProperties(obj) {
  // Check if obj is an actual object or array to avoid errors
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  Object.keys(obj).forEach(key => {
    const value = obj[key];

    // Check if key contains 'password' (case-insensitive)
    if (/password/i.test(key)) {
      if (typeof value === 'string') {
        obj[key] = '********'; // Redact string
      }
    } else if (typeof value === 'object') {
      // Recurse into nested object or array
      maskPasswordProperties(value);
    }

  });

  return obj;
}

function objuscate(text) {
  return text.replace(/password=(.*?)(?=\s|,|$)/gi, "Password=******");
}

function extractJSON(text) {
  let start = text.indexOf('{');
  while (start !== -1) {
    let end = text.lastIndexOf('}');
    if (end === -1) break;

    const candidate = text.slice(start, end + 1);

    try {
      return JSON.parse(candidate);
    } catch (e) {
      // Try next possible start
      start = text.indexOf('{', start + 1);
    }
  }
  return null;
}