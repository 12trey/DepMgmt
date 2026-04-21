const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const paths = require('../paths');
const logStream = require('./logStream');

const TOOL_NAME = 'IntuneWinAppUtil.exe';
const TOOLS_DIR = path.join(paths.userDataDir, 'tools');
const TOOL_PATH = path.join(TOOLS_DIR, TOOL_NAME);
const VERSION_FILE = path.join(TOOLS_DIR, 'IntuneWinAppUtil.version.txt');
const GITHUB_API = 'https://api.github.com/repos/microsoft/microsoft-win32-content-prep-tool/releases/latest';

function checkTool() {
  const installed = fs.existsSync(TOOL_PATH);
  let version = null;
  if (installed && fs.existsSync(VERSION_FILE)) {
    version = fs.readFileSync(VERSION_FILE, 'utf-8').trim();
  }
  return { installed, path: TOOL_PATH, version };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'PSADT-DMT-App/1.0', 'Accept': 'application/vnd.github.v3+json' },
    };
    const req = mod.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Request timed out')); });
  });
}

function downloadBuffer(url, onProgress) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'PSADT-DMT-App/1.0' },
    };
    const req = mod.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
        received += chunk.length;
        if (total > 0) {
          const pct = Math.round((received / total) * 100);
          onProgress?.(`Downloading... ${pct}% (${(received / 1024).toFixed(0)} KB / ${(total / 1024).toFixed(0)} KB)`);
        }
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('Download timed out')); });
  });
}

async function downloadTool(onProgress) {
  fs.mkdirSync(TOOLS_DIR, { recursive: true });

  onProgress?.('Fetching latest release info from GitHub...');
  const release = await fetchJson(GITHUB_API);
  const version = release.tag_name;
  onProgress?.(`Latest version: ${version}`);

  // Prefer a direct IntuneWinAppUtil.exe release asset
  const exeAsset = (release.assets || []).find(
    (a) => a.name.toLowerCase() === 'intunewinapputil.exe'
  );

  if (exeAsset) {
    onProgress?.(`Downloading ${TOOL_NAME} directly from release assets...`);
    const buffer = await downloadBuffer(exeAsset.browser_download_url, onProgress);
    fs.writeFileSync(TOOL_PATH, buffer);
  } else {
    // Fall back to source zip which includes the compiled exe
    onProgress?.('No direct binary asset found, downloading source archive...');
    const zipBuffer = await downloadBuffer(release.zipball_url, onProgress);
    onProgress?.('Extracting IntuneWinAppUtil.exe from archive...');
    const zip = new AdmZip(zipBuffer);
    const exeEntry = zip.getEntries().find((e) =>
      e.entryName.toLowerCase().endsWith('intunewinapputil.exe')
    );
    if (!exeEntry) {
      throw new Error('IntuneWinAppUtil.exe not found in release archive');
    }
    fs.writeFileSync(TOOL_PATH, exeEntry.getData());
  }

  fs.writeFileSync(VERSION_FILE, version, 'utf-8');
  onProgress?.(`Tool ready at: ${TOOL_PATH}`);
  return { version, path: TOOL_PATH };
}

function checkOutputFolder(folder) {
  try {
    if (!fs.existsSync(folder)) return { hasContent: false, count: 0 };
    const entries = fs.readdirSync(folder);
    return { hasContent: entries.length > 0, count: entries.length };
  } catch (err) {
    return { hasContent: false, count: 0, error: err.message };
  }
}

function clearOutputFolder(folder) {
  const entries = fs.readdirSync(folder);
  for (const entry of entries) {
    fs.rmSync(path.join(folder, entry), { recursive: true, force: true });
  }
}

function buildIntuneWin({ setupFolder, sourceFile, outputFolder, addCatalog, catalogFolder }) {
  const execId = uuidv4();

  const args = ['-c', setupFolder, '-s', sourceFile, '-o', outputFolder, '-q'];
  if (addCatalog && catalogFolder) args.push('-a', catalogFolder);

  const cmdLine = [TOOL_NAME, ...args].join(' ');
  logStream.broadcast(execId, `> ${cmdLine}`, 'system');
  logStream.broadcast(execId, '', 'system');

  const child = execFile(TOOL_PATH, args, { windowsHide: false });

  child.stdout?.on('data', (data) => {
    String(data).split(/\r?\n/).filter(Boolean).forEach((line) => {
      logStream.broadcast(execId, line, 'stdout');
    });
  });
  child.stderr?.on('data', (data) => {
    String(data).split(/\r?\n/).filter(Boolean).forEach((line) => {
      logStream.broadcast(execId, line, 'stderr');
    });
  });
  child.on('close', (code) => {
    logStream.broadcast(execId, '', 'system');
    if (code === 0) {
      logStream.broadcast(execId, 'Build completed successfully.', 'system');
    } else {
      logStream.broadcast(execId, `Process exited with code ${code}`, 'stderr');
    }
  });
  child.on('error', (err) => {
    logStream.broadcast(execId, `Failed to start process: ${err.message}`, 'stderr');
  });

  return execId;
}

module.exports = { checkTool, downloadTool, buildIntuneWin, checkOutputFolder, clearOutputFolder };
