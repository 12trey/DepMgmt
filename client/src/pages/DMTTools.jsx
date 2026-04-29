import { useEffect, useState, useRef, useCallback } from 'react';
import { RefreshCw, ChevronDown, CheckCircle, XCircle, AlertCircle, Loader2, Settings, Upload, TerminalSquare, X, Wrench, Plus, Minus } from 'lucide-react';

const STORAGE_KEY = 'dmt-wsl-instance';
const SKIP_ENV_CHECK_KEY = 'dmt-skip-env-check';

const DMT_URL = 'http://localhost:7000';
const POLL_INTERVAL = 2000;
const LAUNCH_TIMEOUT = 30000;

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchInstances() {
  const r = await fetch('/api/wsl/instances');
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function readSkipEnvCheck() {
  return localStorage.getItem(SKIP_ENV_CHECK_KEY) === 'true';
}

async function fetchSkipEnvCheck() {
  try {
    const r = await fetch('/api/config');
    if (!r.ok) return readSkipEnvCheck();
    const c = await r.json();
    const val = c.dmt?.skipEnvCheck === true;
    localStorage.setItem(SKIP_ENV_CHECK_KEY, String(val));
    return val;
  } catch {
    return readSkipEnvCheck();
  }
}

async function checkSetup(instance) {
  const r = await fetch('/api/wsl/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function syncApp(instance) {
  const r = await fetch('/api/wsl/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function launchApp(instance) {
  const r = await fetch('/api/wsl/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function runSetup(instance, onLine, runAsRoot, krb5) {
  const r = await fetch('/api/wsl/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance, runAsRoot: runAsRoot || undefined, krb5 }),
  });
  if (!r.ok) throw new Error(await r.text());

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const part of parts) {
      const line = part.replace(/^data: /, '');
      if (line) {
        try { onLine(JSON.parse(line)); } catch { /* ignore */ }
      }
    }
  }
}

// ── Status badge ───────────────────────────────────────────────────────────────

function Badge({ ok, label }) {
  if (ok === null) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
      ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {ok ? <CheckCircle size={11} /> : <XCircle size={11} />}
      {label}
    </span>
  );
}

// ── Integrated terminal panel ──────────────────────────────────────────────────

function TerminalPanel({ instance, onClose }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    let term;
    let fitAddon;

    async function init() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"Cascadia Code", "Consolas", monospace',
        theme: {
          background: '#0d1117',
          foreground: '#e6edf3',
          cursor: '#58a6ff',
          selectionBackground: '#264f78',
        },
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      // FitAddon.fit() calculates cols from the full container width, but xterm's
      // internal scrollbar overlays the rightmost ~17px of the canvas, cutting off
      // the last 1-2 characters. Use proposeDimensions() and subtract 2 cols so
      // text never reaches the scrollbar zone.
      const fit = () => {
        const dims = fitAddon.proposeDimensions();
        if (!dims) return;
        const cols = Math.max(2, dims.cols - 2);
        if (term.cols !== cols || term.rows !== dims.rows) {
          term.resize(cols, dims.rows);
        }
      };

      // Defer fit until the browser has resolved the flex container's dimensions.
      await new Promise(resolve => requestAnimationFrame(resolve));
      fit();
      termRef.current = term;

      // Focus the underlying textarea with preventScroll:true.
      // term.focus() doesn't pass preventScroll, so the browser auto-scrolls the
      // page to reveal the hidden input element, making the cursor appear to jump
      // to the bottom. Querying the textarea and focusing it directly avoids this.
      const ta = containerRef.current?.querySelector('textarea');
      if (ta) ta.focus({ preventScroll: true });
      else term.focus();

      // Open WebSocket with initial terminal dimensions so Python can set the
      // PTY size correctly from the start.
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${proto}//${window.location.host}/ws/terminal` +
        `?instance=${encodeURIComponent(instance)}&cols=${term.cols}&rows=${term.rows}`
      );
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (e) => {
        const data = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data;
        term.write(data);
      };
      ws.onclose = () => term.write('\r\n\x1b[31m[connection closed]\x1b[0m\r\n');
      ws.onerror = () => term.write('\r\n\x1b[31m[websocket error]\x1b[0m\r\n');

      // Forward keypresses/paste to the PTY
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      // Forward resize events using the null-byte protocol:
      // 5 bytes: [0x00, cols_hi, cols_lo, rows_hi, rows_lo]
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          const msg = new Uint8Array(5);
          msg[0] = 0x00;
          msg[1] = (cols >> 8) & 0xff;
          msg[2] = cols & 0xff;
          msg[3] = (rows >> 8) & 0xff;
          msg[4] = rows & 0xff;
          ws.send(msg.buffer);
        }
      });
    }

    init().catch(console.error);

    const onResize = () => {
      try {
        if (!fitAddon) return;
        const dims = fitAddon.proposeDimensions();
        if (!dims) return;
        const cols = Math.max(2, dims.cols - 2);
        if (term.cols !== cols || term.rows !== dims.rows) term.resize(cols, dims.rows);
      } catch {}
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      try { wsRef.current?.close(); } catch {}
      try { termRef.current?.dispose(); } catch {}
    };
  }, [instance]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col border-t border-gray-200 bg-[#0d1117] shrink-0" style={{ height: '280px' }}>
      <div className="flex items-center justify-between px-3 py-1 bg-gray-800 border-b border-gray-700">
        <span className="text-xs text-gray-300 font-mono">Terminal — {instance}</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white"
          title="Close terminal"
        >
          <X size={14} />
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden p-1"
        onClick={() => {
          const ta = containerRef.current?.querySelector('textarea');
          if (ta) ta.focus({ preventScroll: true });
          else termRef.current?.focus();
        }}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const DEFAULT_KRB5 = {
  realm: '',
  kdcServers: [''],
  adminServer: '',
  defaultDomain: '',
  timezone: 'America/New_York',
};

export default function DMTTools() {
  const [stage, setStage] = useState(() =>
    localStorage.getItem(STORAGE_KEY) ? 'launching' : 'select-instance'
  );
  const [instances, setInstances] = useState([]);
  const [selectedInstance, setSelectedInstance] = useState(() => localStorage.getItem(STORAGE_KEY) || '');
  const [checkResult, setCheckResult] = useState(null);
  const [setupLog, setSetupLog] = useState([]);
  const [error, setError] = useState('');
  const [serviceAvailable, setServiceAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [showTerminal, setShowTerminal] = useState(false);
  const [requiresSudo, setRequiresSudo] = useState(false);
  const [krb5Config, setKrb5Config] = useState(DEFAULT_KRB5);
  const [krb5Open, setKrb5Open] = useState(true);
  const pollRef = useRef(null);
  const launchTimerRef = useRef(null);
  const logBottomRef = useRef(null);
  const iframeRef = useRef(null);
  // Incremented on every reset() so stale async callbacks can detect they've
  // been superseded and skip their setState calls.
  const opGenRef = useRef(0);

  useEffect(() => {
    fetchInstances()
      .then(({ instances: list }) => {
        setInstances(list);
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && list.includes(saved)) {
          handleInstanceSelect(saved);
        }
      })
      .catch(err => { setError(err.message); setStage('error'); });

    const handler = (event) => {
      if (window.electronAPI?.sendToMain) window.electronAPI.sendToMain(event.data.payload);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [setupLog]);

  const startPolling = useCallback((instance) => {
    const gen = opGenRef.current;
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      try {
        await fetch(DMT_URL, { mode: 'no-cors', signal: AbortSignal.timeout(2000) });
        if (opGenRef.current !== gen) return; // reset() was called while fetch was in-flight
        clearInterval(pollRef.current);
        clearTimeout(launchTimerRef.current);
        setServiceAvailable(true);
        setStage('ready');
      } catch {
        if (opGenRef.current !== gen) return;
        if (elapsed >= LAUNCH_TIMEOUT) {
          clearInterval(pollRef.current);
          setError(`Service did not start on port 7000 within ${LAUNCH_TIMEOUT / 1000}s.`);
          setStage('error');
        }
      }
    }, POLL_INTERVAL);
  }, []);

  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearTimeout(launchTimerRef.current);
  }, []);

  // ── Krb5 config helpers ──────────────────────────────────────────────────────

  const updateKrb5 = (field, value) => setKrb5Config(c => ({ ...c, [field]: value }));

  const handleRealmChange = (value) => {
    const upper = value.toUpperCase();
    setKrb5Config(c => ({
      ...c,
      realm: upper,
      // Auto-fill defaultDomain when it's empty or still tracks the old realm
      defaultDomain: (!c.defaultDomain || c.defaultDomain === c.realm.toLowerCase())
        ? upper.toLowerCase()
        : c.defaultDomain,
    }));
  };

  const updateKdc = (i, value) => setKrb5Config(c => {
    const servers = [...c.kdcServers];
    servers[i] = value;
    return { ...c, kdcServers: servers };
  });

  const addKdc = () => setKrb5Config(c => ({ ...c, kdcServers: [...c.kdcServers, ''] }));

  const removeKdc = (i) => setKrb5Config(c => {
    const servers = c.kdcServers.filter((_, idx) => idx !== i);
    const next = servers.length ? servers : [''];
    // Clear adminServer if it was the removed entry
    const removed = c.kdcServers[i];
    const admin = c.adminServer === removed ? next[0] || '' : c.adminServer;
    return { ...c, kdcServers: next, adminServer: admin };
  });

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleInstanceSelect = async (instance) => {
    if (!instance) return;
    const gen = ++opGenRef.current;
    localStorage.setItem(STORAGE_KEY, instance);
    setSelectedInstance(instance);
    setCheckResult(null);
    setError('');

    try {
      // Always probe the service first — if it's already running we go straight
      // to ready with no intermediate UI regardless of any other setting.
      try {
        await fetch(DMT_URL, { mode: 'no-cors', signal: AbortSignal.timeout(1500) });
        if (opGenRef.current !== gen) return;
        setServiceAvailable(true);
        setStage('ready');
        return;
      } catch {
        if (opGenRef.current !== gen) return;
      }

      // Service isn't running. Refresh the skip flag from the server in the
      // background (sync read is the fast path; fetch corrects it if stale).
      const skipEnvCheck = readSkipEnvCheck() || await fetchSkipEnvCheck();
      if (opGenRef.current !== gen) return;

      if (!skipEnvCheck) {
        setStage('checking');
        const result = await checkSetup(instance);
        if (opGenRef.current !== gen) return;
        setCheckResult(result);
        if (!result.ready) { setStage('setup-needed'); return; }
      }

      setStage('launching');
      await launchApp(instance);
      if (opGenRef.current !== gen) return;
      startPolling(instance);
    } catch (err) {
      if (opGenRef.current !== gen) return;
      setError(err.message);
      setStage('error');
    }
  };

  const handleRerunSetup = async () => {
    // Re-check the environment so badges are fresh, then drop into the setup form
    // so the user can review/edit Kerberos config before running.
    setStage('checking');
    try {
      const result = await checkSetup(selectedInstance);
      setCheckResult(result);
      setKrb5Open(true);
      setStage('setup-needed');
    } catch (err) {
      setError(err.message);
      setStage('error');
    }
  };

  const handleRunSetup = async () => {
    setStage('setting-up');
    setSetupLog([]);
    try {
      await runSetup(selectedInstance, (msg) => {
        setSetupLog(prev => [...prev, msg]);
      }, requiresSudo ? true : undefined, krb5Config);
      const result = await checkSetup(selectedInstance);
      setCheckResult(result);
      if (result.ready) {
        setStage('launching');
        await launchApp(selectedInstance);
        startPolling(selectedInstance);
      } else {
        setError('Setup finished but environment is still not ready. Check the log above.');
        setStage('error');
      }
    } catch (err) {
      setError(err.message);
      setStage('error');
    }
  };

  const handleLaunch = async () => {
    setStage('launching');
    try {
      await launchApp(selectedInstance);
      startPolling(selectedInstance);
    } catch (err) {
      setError(err.message);
      setStage('error');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      await syncApp(selectedInstance);
      setSyncMsg('Synced — reloading…');
      // Give the freshly-restarted server a moment to come up before reloading
      setTimeout(() => {
        if (iframeRef.current) iframeRef.current.src = DMT_URL;
        setSyncMsg('Synced.');
      }, 2000);
    } catch (err) {
      setSyncMsg(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const reset = () => {
    opGenRef.current++; // invalidate any in-flight async callbacks
    clearInterval(pollRef.current);
    setStage('select-instance');
    setSelectedInstance('');
    setCheckResult(null);
    setSetupLog([]);
    setError('');
    setServiceAvailable(false);
    setShowTerminal(false);
  };

  // ── Render: iframe + optional terminal ───────────────────────────────────────

  if (stage === 'ready') {
    return (
      <div className="-m-6 flex flex-col" style={{ height: 'calc(100% + 3rem)' }}>
        {/* Header bar */}
        <div className="flex items-center justify-between px-3 py-1 bg-gray-50 border-b border-gray-200 shrink-0 gap-4">
          <span className="text-xs text-gray-500">
            WSL: <strong>{selectedInstance}</strong>
          </span>
          <div className="flex items-center gap-3">
            {syncMsg && (
              <span className="text-xs text-gray-500 italic">{syncMsg}</span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
              title="Sync ansible-app/ from this project to WSL, rebuild, and restart"
            >
              {syncing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              Sync to WSL
            </button>
            <button
              onClick={() => { if (iframeRef.current) iframeRef.current.src = DMT_URL; }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              title="Reload the DMT Tools app"
            >
              <RefreshCw size={11} />
              Reload
            </button>
            <button
              onClick={() => setShowTerminal(v => !v)}
              className={`flex items-center gap-1 text-xs ${showTerminal ? 'text-green-600 hover:text-green-800' : 'text-gray-500 hover:text-gray-700'}`}
              title="Toggle integrated terminal"
            >
              <TerminalSquare size={13} />
              Terminal
            </button>
            <button
              onClick={handleRerunSetup}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700"
              title="Re-run setup — returns to setup form so you can review Kerberos config"
            >
              <Wrench size={11} /> Re-run Setup
            </button>
            <button
              onClick={() => { localStorage.removeItem(STORAGE_KEY); reset(); }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700"
            >
              <Settings size={11} /> Change instance
            </button>
          </div>
        </div>

        {/* Main content: iframe grows to fill space */}
        <iframe
          ref={iframeRef}
          src={DMT_URL}
          className="w-full flex-1 border-0 min-h-0"
          title="DMT Tools"
          allow="clipboard-read *; clipboard-write *;"
        />

        {/* Integrated terminal — shown below iframe */}
        {showTerminal && (
          <TerminalPanel
            instance={selectedInstance}
            onClose={() => setShowTerminal(false)}
          />
        )}
      </div>
    );
  }

  // ── Render: setup flow ───────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center justify-center min-h-64 py-8">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 w-full max-w-lg space-y-5">

        <div>
          <h2 className="text-base font-semibold text-gray-800">Ansible DMT Tools</h2>
          <p className="text-xs text-gray-500 mt-0.5">Select a WSL instance to host the Ansible UI.</p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">WSL Instance</label>
          <div className="relative">
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm appearance-none bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              value={selectedInstance}
              onChange={e => handleInstanceSelect(e.target.value)}
              disabled={stage !== 'select-instance' && stage !== 'setup-needed'}
            >
              <option value="">-- Select a WSL instance --</option>
              {instances.map(inst => (
                <option key={inst} value={inst}>{inst}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {stage === 'checking' && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            Checking environment in <strong>{selectedInstance}</strong>…
          </div>
        )}

        {checkResult && stage === 'setup-needed' && (() => {
          const validKdcs = krb5Config.kdcServers.filter(Boolean);
          const krb5Valid = krb5Config.realm.trim().length > 0 && validKdcs.length > 0;
          return (
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-600">Environment checks:</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge ok={checkResult.checks.node} label={`Node ${checkResult.checks.nodeVersion || ''}`} />
                <Badge ok={checkResult.checks.ansible} label="Ansible" />
                <Badge ok={checkResult.checks.pythonVenv} label="Python venv" />
                <Badge ok={checkResult.checks.appDir} label="App directory" />
                <Badge ok={checkResult.checks.appEntry} label="app.js" />
              </div>
              {checkResult.checks.missingPackages?.length > 0 && (
                <p className="text-xs text-amber-600">
                  Missing packages: {checkResult.checks.missingPackages.join(', ')}
                </p>
              )}

              {/* Kerberos configuration */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setKrb5Open(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  <span className="flex items-center gap-1.5">
                    {krb5Valid
                      ? <CheckCircle size={12} className="text-green-500" />
                      : <AlertCircle size={12} className="text-amber-500" />}
                    Kerberos Configuration
                    {!krb5Valid && <span className="text-amber-500 font-normal">(required)</span>}
                  </span>
                  <ChevronDown size={12} className={`transition-transform ${krb5Open ? 'rotate-180' : ''}`} />
                </button>

                {krb5Open && (
                  <div className="p-3 space-y-2.5 text-xs border-t border-gray-100">

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-gray-600 mb-0.5 font-medium">Realm *</label>
                        <input
                          type="text"
                          value={krb5Config.realm}
                          onChange={e => handleRealmChange(e.target.value)}
                          placeholder="CORP.EXAMPLE.COM"
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-gray-600 mb-0.5 font-medium">Default Domain</label>
                        <input
                          type="text"
                          value={krb5Config.defaultDomain}
                          onChange={e => updateKrb5('defaultDomain', e.target.value)}
                          placeholder="corp.example.com"
                          className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-600 mb-0.5 font-medium">Timezone</label>
                      <input
                        type="text"
                        value={krb5Config.timezone}
                        onChange={e => updateKrb5('timezone', e.target.value)}
                        placeholder="America/New_York"
                        className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-gray-600 font-medium">KDC Servers *</label>
                        <button
                          type="button"
                          onClick={addKdc}
                          className="flex items-center gap-0.5 text-blue-600 hover:text-blue-800 text-xs"
                        >
                          <Plus size={11} /> Add
                        </button>
                      </div>
                      <div className="space-y-1">
                        {krb5Config.kdcServers.map((kdc, i) => (
                          <div key={i} className="flex gap-1">
                            <input
                              type="text"
                              value={kdc}
                              onChange={e => updateKdc(i, e.target.value)}
                              placeholder="kdc.example.com"
                              className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                            {krb5Config.kdcServers.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeKdc(i)}
                                className="text-red-400 hover:text-red-600 px-1"
                                title="Remove this KDC"
                              >
                                <Minus size={12} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-gray-600 mb-0.5 font-medium">Admin Server</label>
                      <input
                        type="text"
                        value={krb5Config.adminServer}
                        onChange={e => updateKrb5('adminServer', e.target.value)}
                        placeholder={validKdcs[0] || 'admin.example.com'}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <p className="text-gray-400 mt-0.5">Leave blank to use the first KDC</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-0.5">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={requiresSudo}
                    onChange={e => setRequiresSudo(e.target.checked)}
                    className="rounded"
                  />
                  Default user is not root — run setup as root
                </label>
                {requiresSudo && (
                  <p className="text-xs text-amber-600 mt-1 ml-5">
                    Setup will run as root via <code>wsl -u root</code>. No password needed.
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={handleRunSetup} disabled={!krb5Valid} className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed">
                  Run Setup
                </button>
                {checkResult.checks.node && checkResult.checks.appEntry && (
                  <button onClick={handleLaunch} className="btn-secondary text-sm">
                    Skip — Launch Anyway
                  </button>
                )}
              </div>
            </div>
          );
        })()}

        {(stage === 'setting-up' || (stage === 'error' && setupLog.length > 0)) && (
          <div className="space-y-2">
            {stage === 'setting-up' && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                Running setup…
              </div>
            )}
            <div className="bg-gray-950 text-gray-100 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs space-y-0.5">
              {setupLog.map((msg, i) => (
                <div key={i} className={msg.type === 'stderr' ? 'text-yellow-300' : msg.type === 'error' ? 'text-red-400' : ''}>
                  {msg.line || (msg.type === 'exit' ? `[exit ${msg.code}]` : JSON.stringify(msg))}
                </div>
              ))}
              <div ref={logBottomRef} />
            </div>
          </div>
        )}

        {stage === 'launching' && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            Launching app… waiting for service on port 7000
          </div>
        )}

        {stage === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
            <div className="flex items-start gap-2 text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <button onClick={reset} className="btn-secondary text-xs">
              <RefreshCw size={12} /> Start Over
            </button>
          </div>
        )}

        {(stage === 'checking' || stage === 'setting-up' || stage === 'launching') && (
          <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <RefreshCw size={11} /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}
