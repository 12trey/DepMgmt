const vscode = require('vscode');

let _panel = null;
let _context = null;
let _buffer = '';
let _updateTimer = null;

// ESC character for ANSI sequence matching (avoids literal escape in source)
const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp('(' + ESC + '\\[[0-9;]*m)');

function init(context) {
  _context = context;
}

function show() {
  if (!_context) return;
  if (_panel) {
    _panel.reveal(vscode.ViewColumn.Two, true);
    return;
  }
  _panel = vscode.window.createWebviewPanel(
    'ansibleOutput',
    'Ansible Output',
    { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );

  _panel.webview.onDidReceiveMessage(
      message => {
          if (message.command === 'showAlert') {
              vscode.window.showInformationMessage(message.text);
          }
      },
      undefined,
      _context.subscriptions
  );

  _render();
  _panel.onDidDispose(() => {
    _panel = null;
    initialized = false;
    if (_updateTimer) { clearTimeout(_updateTimer); _updateTimer = null; }
  }, null, _context.subscriptions);
}

var _currentText = '';
function clear() {
  _buffer = '';
  _currentText = '';
  if(_panel.webview) {
    _panel.webview.postMessage({ 
      command: 'clear',
      payload: ''
    });
  }

  if (_updateTimer) { clearTimeout(_updateTimer); _updateTimer = null; }
  _render();
}

function append(text) {
  _buffer += text;
  _currentText = text;
  if(!_panel) return;
  //if (!_panel || _updateTimer) return;
  //_updateTimer = setTimeout(() => {
  //  _updateTimer = null;
    _render();
  //}, 150);
}

// ── Internal ──────────────────────────────────────────────────────────────────
var initialized = false;
function _render() {
  if (!_panel) return;
  //_panel.webview.html = _buildHtml(_buffer);
  if(!initialized) {
    _panel.webview.html = _buildHtml(_buffer);
    initialized = true;
  }
  else{
    _panel.webview.postMessage({ 
      command: 'appendData', 
      payload: _ansiToHtml(_currentText)
    });
  }
}

function _escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _ansiToHtml(raw) {
  const segs = raw.split(ANSI_RE);
  let html = '';
  let depth = 0;
  for (const seg of segs) {
    if (seg.charCodeAt(0) === 27) {
      // ANSI SGR sequence
      const inner = seg.slice(2, -1); // strip ESC[ and m
      const codes = inner ? inner.split(';').map(Number) : [0];
      if (codes.includes(0)) {
        html += '</span>'.repeat(depth);
        depth = 0;
      } else {
        const cls = [];
        for (const c of codes) {
          if (c === 1) cls.push('b');
          else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) cls.push('c' + c);
        }
        if (cls.length) { html += '<span class="' + cls.join(' ') + '">'; depth++; }
      }
    } else {
      html += _escHtml(seg);
    }
  }
  html += '</span>'.repeat(depth);
  return html;
}

function _buildHtml(text) {
  const body = text
    ? _ansiToHtml(text)
    : '<span class="dim">Waiting for Ansible output…</span>';

  return `<!DOCTYPE html>
    <html lang="en"><head><meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--vscode-terminal-background,#1e1e1e);color:var(--vscode-terminal-foreground,#ccc);
    font-family:var(--vscode-editor-font-family,"Courier New",monospace);
    font-size:var(--vscode-editor-font-size,13px);padding:8px 12px}
    #o{white-space:pre-wrap;line-height:1.5;color:#84abcc;}
    .dim{opacity:.4}.b{font-weight:bold}
    .c30{color:#000}.c31{color:#cd3131}.c32{color:#0dbc79}.c33{color:#e5e510}
    .c34{color:#2472c8}.c35{color:#bc3fbc}.c36{color:#11a8cd}.c37{color:#e5e5e5}
    .c90{color:#555}.c91{color:#f14c4c}.c92{color:#23d18b}.c93{color:#f5f543}
    .c94{color:#3b8eea}.c95{color:#d670d6}.c96{color:#29b8db}.c97{color:#e5e5e5}
    </style></head><body>
    <div id="o"> ${body} </div>
    <script>
    let parsedtext = [];
    let stdlines = '';

    window.scrollTo(0,document.body.scrollHeight);
    window.addEventListener('message', event => {
      const message = event.data; // The JSON data sent from the extension
      switch (message.command) {
          case 'clear':
              const ocontainer = document.getElementById('o');
              ocontainer.innerHTML = '';
          break;
          case 'appendData':
              const container = document.getElementById('o');
              const newElement = document.createElement('div');
              newElement.innerHTML = message.payload;
              container.appendChild(newElement); // Appends without rebuilding

              let regex = /(\\s+ok:)/gi;
              if(message.payload.match(regex)) {
                newElement.innerHTML = newElement.innerHTML.replace(regex, '<span style="color: #6bcf68; font-weight: bold;">$1</span>');
              }

              regex = /(\\s+\\[ERROR\\])/gi;
              if(message.payload.toUpperCase().match(regex)) {
                newElement.innerHTML = newElement.innerHTML.replace(regex, '<span style="color: #ec4b4b; font-weight: bold;">$1</span>');
              }

              regex = /("msg":\\s".*"),/gi;
              if(message.payload.toUpperCase().match(regex)) {
                newElement.innerHTML = newElement.innerHTML.replace(regex, '<span style="color: #cda65e; font-weight: bold;">$1</span>,');
              }

              regex = /(TASK.*\\*+)/gi;
              if(message.payload.toUpperCase().match(regex)) {
                newElement.innerHTML = newElement.innerHTML.replace(regex, '<span style="color: #cda65e; font-weight: bold;">$1</span>');
              }

              
              regex = /("result.stdout":.*")/gi;
              if(message.payload.toUpperCase().match(regex)) {
                parsedtext = message.payload.match(regex);
                newElement.innerHTML = newElement.innerHTML.replace(regex, '<span style="color: #cda65e; font-weight: bold;">$1</span>');
              }
              
              

              let finished = false;
              regex = /(Playbook completed successfully\\.)/gi;
              if(message.payload.toUpperCase().match(regex)) {
                newElement.innerHTML = newElement.innerHTML.replace(regex, '<span style="color: #cda65e; font-weight: bold;">$1</span>');
                finished = true;
              }

              regex = /(Playbook exited with code \\d+.)/gi;
              if(message.payload.toUpperCase().match(regex)) {
                newElement.innerHTML = newElement.innerHTML.replace(regex, '<span style="color: #ec4b4b; font-weight: bold;">$1</span>');
                finished = true;
              }

              regex = /(\\s+\\"stdout_lines[\\s\\S]*\\])/gmi;
              if(newElement.innerHTML.match(regex)) {
                newElement.innerHTML = newElement.innerHTML.replace(regex, '<span style="color: #cda65e; font-weight: bold;">$1</span>');
              }
                
              if(finished) {

                if(parsedtext.length > 0) {
                  container.appendChild(document.createElement('br'));
                  let parsedElement = document.createElement('div');
                  let pretext = '"result.stdout": ';
                  var newtext = parsedtext[0]
                    .replace(pretext, '')
                    .replaceAll('\\\\r', '')
                    .replaceAll('\\\\n', '<br />');

                  newtext = newtext
                              .substring(1)
                              .substring(0, newtext.length-2)

                  parsedElement.innerHTML = newtext;
                  container.appendChild(document.createElement('hr'));
                  let header = document.createElement('h2');
                  header.textContent = "Formatted output";
                  header.style.textDecoration = 'underline';
                  container.appendChild(header);
                  container.appendChild(parsedElement);
                }
                let vscode = acquireVsCodeApi();
                vscode.postMessage({
                    command: 'showAlert',
                    text: 'Playbook run completed.'
                });

              }
              setTimeout(()=>{ 
                window.scrollTo(0,document.body.scrollHeight);
              },100);
              break;
      }
    });
    </script>
    </body></html>`;
}

module.exports = { init, show, clear, append };
