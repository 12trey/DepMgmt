const simpleGit = require('simple-git');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const paths = require('../paths');

const BINARY_EXTS = new Set(['.exe', '.msi', '.msp', '.msu', '.cab', '.zip', '.7z', '.iso', '.img', '.bin']);

function isBinary(filename) {
  return BINARY_EXTS.has(path.extname(filename).toLowerCase());
}

function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(filePath).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function buildFilesManifest(filesDir) {
  if (!fs.existsSync(filesDir)) return [];
  const entries = [];
  for (const name of fs.readdirSync(filesDir)) {
    const fp = path.join(filesDir, name);
    if (!fs.statSync(fp).isFile() || name === 'README.md') continue;
    entries.push({ name, size: fs.statSync(fp).size, sha256: await sha256File(fp) });
  }
  return entries;
}

function buildReadme(appName, version, entries) {
  const lines = [
    `# Required Installer Files — ${appName} v${version}`,
    ``,
    `Place the following files in this \`Files/\` directory before running the deployment.`,
    `These files are **not stored in Git**. Obtain them from your software distribution source.`,
    ``,
  ];
  if (entries.length === 0) {
    lines.push('_No installer files required for this package._');
  } else {
    lines.push('| Filename | Size | SHA-256 |', '|----------|------|---------|');
    for (const e of entries) lines.push(`| \`${e.name}\` | ${formatBytes(e.size)} | \`${e.sha256}\` |`);
  }
  lines.push('');
  return lines.join('\n');
}

function copyPackageToRepo(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'PSAppDeployToolkit') continue; // module ships separately
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'Files') {
        // Copy non-binary files only; README is written separately
        fs.mkdirSync(d, { recursive: true });
        for (const f of fs.readdirSync(s, { withFileTypes: true })) {
          if (f.isFile() && !isBinary(f.name) && f.name !== 'README.md') {
            fs.copyFileSync(path.join(s, f.name), path.join(d, f.name));
          }
        }
      } else {
        fs.cpSync(s, d, { recursive: true });
      }
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function getConfig() {
  return JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
}

function getGit() {
  return simpleGit(paths.repoDir);
}

exports.clone = async (url) => {
  const config = getConfig();
  const repoUrl = url || config.repository.url;
  if (!repoUrl) throw new Error('No repository URL configured');
  fs.mkdirSync(paths.repoDir, { recursive: true });
  await simpleGit().clone(repoUrl, paths.repoDir);
  return { message: 'Repository cloned', path: paths.repoDir };
};

exports.pull = async () => {
  if (!fs.existsSync(path.join(paths.repoDir, '.git'))) throw new Error('No git repository found');
  const result = await getGit().pull();
  return { message: 'Pull complete', summary: result };
};

exports.push = async () => {
  if (!fs.existsSync(path.join(paths.repoDir, '.git'))) throw new Error('No git repository found');
  const git = getGit();
  const status = await git.status();
  const branch = status.current;
  // --set-upstream ensures it works whether or not the tracking branch is already configured
  await git.push(['origin', branch, '--set-upstream']);
  return { message: `Pushed ${branch} to origin` };
};

exports.status = async () => {
  if (!fs.existsSync(path.join(paths.repoDir, '.git'))) {
    return { initialized: false };
  }
  const result = await getGit().status();
  return { initialized: true, ...result };
};

exports.publish = async (appName, version) => {
  if (!fs.existsSync(path.join(paths.repoDir, '.git'))) throw new Error('No git repository found. Clone one first.');

  const pkgSrc = path.join(paths.packagesDir, appName, version);
  if (!fs.existsSync(pkgSrc)) throw new Error('Package not found');

  const pkgDest = path.join(paths.repoDir, appName, version);

  // Build manifest from actual installer files
  const entries = await buildFilesManifest(path.join(pkgSrc, 'Files'));

  // Copy package to repo (no binaries, no PSAppDeployToolkit)
  copyPackageToRepo(pkgSrc, pkgDest);

  // Write README and machine-readable manifest into repo
  const repoFilesDir = path.join(pkgDest, 'Files');
  fs.mkdirSync(repoFilesDir, { recursive: true });
  fs.writeFileSync(path.join(repoFilesDir, 'README.md'), buildReadme(appName, version, entries));

  const manifest = { appName, version, publishedAt: new Date().toISOString(), files: entries };
  const manifestJson = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(path.join(pkgDest, 'files-manifest.json'), manifestJson);
  // Also store in local package so PackageDetail can read it without touching the repo
  fs.writeFileSync(path.join(pkgSrc, 'files-manifest.json'), manifestJson);

  // Stage and commit
  const git = getGit();
  const relPath = path.relative(paths.repoDir, pkgDest).replace(/\\/g, '/');
  await git.add(relPath);

  const staged = await git.status();
  if (staged.staged.length === 0) {
    return { message: 'Nothing to commit — package is already up to date in the repository.', upToDate: true, files: entries };
  }

  const result = await git.commit(`Publish ${appName} v${version}`);
  return {
    message: `Published and committed: ${appName} v${version} — ${entries.length} file${entries.length !== 1 ? 's' : ''} documented`,
    commit: result.commit,
    files: entries,
  };
};

exports.log = async () => {
  if (!fs.existsSync(path.join(paths.repoDir, '.git'))) return { initialized: false, commits: [], ahead: 0, behind: 0 };
  const git = getGit();
  const [status, allLog] = await Promise.all([
    git.status().catch(() => ({})),
    git.log(['--max-count=20']).catch(() => ({ all: [] })),
  ]);

  let unpushedHashes = new Set();
  try {
    const up = await git.log(['@{u}..HEAD']);
    unpushedHashes = new Set(up.all.map(c => c.hash));
  } catch { /* no upstream configured yet */ }

  return {
    initialized: true,
    current: status.current,
    ahead: status.ahead || 0,
    behind: status.behind || 0,
    commits: allLog.all.map(c => ({
      hash: c.hash.slice(0, 7),
      message: c.message,
      date: c.date,
      author: c.author_name,
      unpushed: unpushedHashes.has(c.hash),
    })),
  };
};
