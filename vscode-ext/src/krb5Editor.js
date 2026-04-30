const vscode = require('vscode');
const { spawn } = require('child_process');

const KRB5_WSL_PATH = '/etc/krb5.conf';

// ── WSL helpers ───────────────────────────────────────────────────────────────

function wslRun(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('wsl.exe', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => (out += d));
    proc.stderr.on('data', d => (err += d));
    proc.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
    proc.on('error', reject);
  });
}

function readArgs(distro) {
  return distro ? ['-d', distro, 'cat', KRB5_WSL_PATH] : ['cat', KRB5_WSL_PATH];
}

// ── Parse / serialize ─────────────────────────────────────────────────────────

function parseKrb5(content) {
  const realm       = (content.match(/^\s*default_realm\s*=\s*(.+)/m)  || [])[1]?.trim() || '';
  const kdcServers  = [...content.matchAll(/^\s*kdc\s*=\s*(.+)/mg)].map(m => m[1].trim());
  const adminServer = (content.match(/^\s*admin_server\s*=\s*(.+)/m)   || [])[1]?.trim() || '';
  const defaultDomain = (content.match(/^\s*default_domain\s*=\s*(.+)/m) || [])[1]?.trim() || '';
  return { realm, kdcServers, adminServer, defaultDomain };
}

function serializeKrb5({ realm, kdcServers, adminServer, defaultDomain }) {
  const r = realm.trim();
  const d = defaultDomain.trim();
  const kdcLines = (kdcServers.length ? kdcServers : ['']).map(k => `        kdc = ${k}`).join('\n');
  const adminLine = adminServer.trim() ? `        admin_server = ${adminServer.trim()}\n` : '';
  const domainLines = d ? `    .${d} = ${r}\n    ${d} = ${r}\n` : '';
  const defaultDomainLine = d ? `    default_domain = ${d}\n` : '';

  return `[libdefaults]
    default_realm = ${r}
${defaultDomainLine}
[realms]
    ${r} = {
${kdcLines}
${adminLine}    }

[domain_realm]
${domainLines}`;
}

// ── Write to WSL as root ──────────────────────────────────────────────────────

async function writeKrb5(distro, content) {
  // Write via stdin to avoid temp-file path escaping issues
  const args = distro
    ? ['-d', distro, '-u', 'root', '-e', 'sh', '-c', `cat > ${KRB5_WSL_PATH}`]
    : ['-u', 'root', '-e', 'sh', '-c', `cat > ${KRB5_WSL_PATH}`];

  return new Promise((resolve, reject) => {
    const proc = spawn('wsl.exe', args);
    let err = '';
    proc.stderr.on('data', d => (err += d));
    proc.on('close', code => resolve({ code, err: err.trim() }));
    proc.on('error', reject);
    proc.stdin.write(content, 'utf-8');
    proc.stdin.end();
  });
}

// ── Webview ───────────────────────────────────────────────────────────────────

function getWebviewHtml(data) {
  const kdcJson = JSON.stringify(data.kdcServers || []);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px 28px;
      max-width: 560px;
    }
    h2 {
      font-size: 1.1em;
      font-weight: 600;
      margin: 0 0 20px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-panel-border, #444);
    }
    .field { margin-bottom: 18px; }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 5px;
      font-size: 0.9em;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.8;
    }
    input[type="text"] {
      width: 100%;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      padding: 5px 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      outline: none;
    }
    input[type="text"]:focus {
      border-color: var(--vscode-focusBorder);
    }
    .kdc-row { display: flex; gap: 6px; margin-bottom: 6px; }
    .kdc-row input { flex: 1; }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 5px 12px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-icon {
      background: transparent;
      color: var(--vscode-errorForeground);
      border: none;
      padding: 5px 7px;
      cursor: pointer;
      font-size: 1em;
      line-height: 1;
    }
    .btn-icon:hover { opacity: 0.75; }
    .actions { display: flex; align-items: center; gap: 10px; margin-top: 24px; }
    #status {
      font-size: 0.9em;
      padding: 4px 0;
    }
    .status-ok  { color: var(--vscode-testing-iconPassed, #4caf50); }
    .status-err { color: var(--vscode-errorForeground); }
    .status-working { opacity: 0.7; }
  </style>
</head>
<body>
  <h2>krb5.conf</h2>

  <div class="field">
    <label>Default Realm</label>
    <input type="text" id="realm" placeholder="DOMAIN.COM" value="${esc(data.realm)}" />
  </div>

  <div class="field">
    <label>KDC Servers</label>
    <div id="kdc-list"></div>
    <button class="btn btn-secondary" onclick="addKdc('')" style="margin-top:4px">+ Add KDC</button>
  </div>

  <div class="field">
    <label>Admin Server</label>
    <input type="text" id="adminServer" placeholder="admin.domain.com" value="${esc(data.adminServer)}" />
  </div>

  <div class="field">
    <label>Default Domain</label>
    <input type="text" id="defaultDomain" placeholder="domain.com" value="${esc(data.defaultDomain)}" />
  </div>

  <div class="actions">
    <button class="btn" onclick="save()">Save to WSL</button>
    <span id="status"></span>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const initialKdcs = ${kdcJson};

    if (initialKdcs.length === 0) {
      addKdc('');
    } else {
      initialKdcs.forEach(k => addKdc(k));
    }

    function addKdc(value) {
      const list = document.getElementById('kdc-list');
      const row = document.createElement('div');
      row.className = 'kdc-row';
      row.innerHTML =
        '<input type="text" class="kdc-input" placeholder="kdc.domain.com" value="' + escAttr(value) + '" />' +
        '<button class="btn-icon" title="Remove" onclick="this.parentElement.remove()">✕</button>';
      list.appendChild(row);
      row.querySelector('input').focus();
    }

    function save() {
      const realm       = document.getElementById('realm').value.trim();
      const adminServer = document.getElementById('adminServer').value.trim();
      const defaultDomain = document.getElementById('defaultDomain').value.trim();
      const kdcServers  = [...document.querySelectorAll('.kdc-input')]
        .map(i => i.value.trim()).filter(Boolean);

      setStatus('Saving…', 'working');
      vscode.postMessage({ type: 'save', data: { realm, adminServer, defaultDomain, kdcServers } });
    }

    window.addEventListener('message', e => {
      const msg = e.data;
      if (msg.type === 'saved') setStatus('✓ Saved successfully', 'ok');
      if (msg.type === 'error') setStatus('✗ ' + msg.message, 'err');
    });

    function setStatus(text, cls) {
      const el = document.getElementById('status');
      el.textContent = text;
      el.className = cls ? 'status-' + cls : '';
      if (cls === 'ok') setTimeout(() => { el.textContent = ''; el.className = ''; }, 3000);
    }

    function escAttr(s) {
      return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }
  </script>
</body>
</html>`;
}

// Simple HTML-escape for values injected into the template
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// ── Public API ────────────────────────────────────────────────────────────────

let _panel = null;

async function openKrb5Conf(distro) {
  // Re-use existing panel if still open
  if (_panel) {
    _panel.reveal();
    return;
  }

  const { code, out, err } = await wslRun(readArgs(distro));
  if (code !== 0) throw new Error(err || `wsl cat ${KRB5_WSL_PATH} failed (exit ${code})`);

  const data = parseKrb5(out);

  _panel = vscode.window.createWebviewPanel(
    'ansibleKrb5Editor',
    'krb5.conf',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  _panel.webview.html = getWebviewHtml(data);

  _panel.webview.onDidReceiveMessage(async msg => {
    if (msg.type !== 'save') return;
    try {
      const content = serializeKrb5(msg.data);
      const result = await writeKrb5(distro, content);
      if (result.code !== 0) throw new Error(result.err || `exit ${result.code}`);
      _panel.webview.postMessage({ type: 'saved' });
    } catch (e) {
      _panel.webview.postMessage({ type: 'error', message: e.message });
    }
  });

  _panel.onDidDispose(() => { _panel = null; });
}

module.exports = { openKrb5Conf };
