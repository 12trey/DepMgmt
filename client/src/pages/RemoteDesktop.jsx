import { useState, useEffect, useRef, useCallback } from 'react';
import Guacamole from 'guacamole-common-js';
import { MonitorPlay, ChevronRight, ChevronLeft, X, Plug, PlugZap, Loader2, Menu } from 'lucide-react';

const DMT_BASE = 'http://localhost:7000';
const CONN_TYPES = ['rdp', 'vnc', 'ssh'];
const DEFAULT_PORTS = { rdp: '3389', vnc: '5900', ssh: '22' };
const EMPTY_FORM = { name: '', type: 'rdp', host: '', port: '3389', username: '', password: '', domain: '', width: '1920', height: '1080', security: 'nla' };
const WSL_INSTANCE_KEY = 'dmt-wsl-instance';

// Estimate the pixel area the remote session canvas will actually occupy.
// Called at connect-time so the initial RDP resolution matches the container —
// avoiding the CSS-scale-then-snap jump that happens when sendSize fires later.
function getInitialResolution() {
  const navCollapsed = localStorage.getItem('navCollapsed') === 'true';
  const sidebarW = navCollapsed ? 56 : 224;  // matches App.jsx w-14 / w-56
  const w = window.innerWidth  - sidebarW;
  const h = window.innerHeight - 38          // tab bar
                               - 37;         // session header (Disconnect bar)
  return { width: String(Math.max(800, w)), height: String(Math.max(600, h)) };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Field({ label, children, half }) {
  return (
    <div className={half ? 'flex flex-col gap-1' : 'flex flex-col gap-1 col-span-2'}>
      {label && <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>}
      {children}
    </div>
  );
}

function Input({ ...props }) {
  return (
    <input
      className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
      {...props}
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function RemoteDesktop() {
  const [dmtReady, setDmtReady] = useState(null); // null=checking, true, false
  const [retryCount, setRetryCount] = useState(0);
  const [connections, setConnections] = useState([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [status, setStatus] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [guacLogs, setGuacLogs] = useState(null);
  const [autoPhase, setAutoPhase] = useState('idle'); // idle|launching|waiting|failed|needs-setup
  const [wslInstances, setWslInstances] = useState([]);
  const [wslInstance, setWslInstance] = useState(() => localStorage.getItem(WSL_INSTANCE_KEY) || '');

  const displayRef = useRef(null);
  const clientRef = useRef(null);
  const keyboardRef = useRef(null);
  const pendingTokenRef = useRef(null);
  const displayScaleRef = useRef(1);
  const autoLaunchedRef = useRef(false);

  // Check if DMT Tools is reachable and load connections
  useEffect(() => {
    setDmtReady(null);
    fetch(`${DMT_BASE}/guacd-status`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        setDmtReady(true);
        if (!d.running) setStatus('guacd is not running. Start DMT Tools and run setup to enable connections.');
        loadConnections();
      })
      .catch(() => setDmtReady(false));
  }, [retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => disconnectClient(), []);

  // Auto-launch DMT Tools the moment we detect it isn't running
  useEffect(() => {
    if (dmtReady !== false || autoLaunchedRef.current) return;
    autoLaunchedRef.current = true;
    kickAutoLaunch(localStorage.getItem(WSL_INSTANCE_KEY) || '');
  }, [dmtReady]); // eslint-disable-line react-hooks/exhaustive-deps

  async function kickAutoLaunch(instance) {
    if (!instance) {
      setAutoPhase('launching');
      try {
        const r = await fetch('/api/wsl/instances');
        if (!r.ok) throw new Error();
        const { instances } = await r.json();
        setWslInstances(instances || []);
        instance = (instances || [])[0] || '';
        setWslInstance(instance);
      } catch {
        setAutoPhase('failed');
        return;
      }
      if (!instance) { setAutoPhase('failed'); return; }
    } else {
      setWslInstance(instance);
    }
    setAutoPhase('launching');
    try {
      const r = await fetch('/api/wsl/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance }),
      });
      if (!r.ok) { setAutoPhase('needs-setup'); return; }
      localStorage.setItem(WSL_INSTANCE_KEY, instance);
      setAutoPhase('waiting');
      for (let i = 0; i < 15; i++) {
        await new Promise(res => setTimeout(res, 2000));
        try {
          const check = await fetch(`${DMT_BASE}/guacd-status`, { signal: AbortSignal.timeout(1500) });
          if (check.ok) { setRetryCount(c => c + 1); return; }
        } catch { /* still starting */ }
      }
      setAutoPhase('needs-setup');
    } catch {
      setAutoPhase('failed');
    }
  }

  const loadConnections = useCallback(async () => {
    try {
      const r = await fetch(`${DMT_BASE}/remote-connections`);
      setConnections(await r.json());
    } catch {
      setConnections([]);
    }
  }, []);

  function setField(f, v) { setForm(prev => ({ ...prev, [f]: v })); }

  function handleTypeChange(type) {
    setForm(prev => ({ ...prev, type, port: DEFAULT_PORTS[type] }));
  }

  function selectConnection(conn) {
    setEditingId(conn.id);
    setForm({
      name: conn.name,
      type: conn.type,
      host: conn.host,
      port: conn.port || DEFAULT_PORTS[conn.type],
      username: conn.username || '',
      password: '',
      domain: conn.domain || '',
      width: conn.width || '1920',
      height: conn.height || '1080',
      security: conn.security || 'any',
    });
    if (!conn.hasPassword) setStatus('No password saved — enter one to connect.');
    else setStatus('');
  }

  function clearForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setStatus('');
  }

  async function handleSave() {
    if (!form.name.trim() || !form.host.trim()) { setStatus('Name and host are required to save.'); return; }
    setSaving(true);
    try {
      const r = await fetch(`${DMT_BASE}/remote-connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, id: editingId || undefined }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      await loadConnections();
      setStatus(editingId ? 'Updated.' : 'Saved.');
    } catch (err) {
      setStatus(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleConnect() {
    if (!form.host.trim()) { setStatus('Host is required.'); return; }
    setConnecting(true);
    setStatus('Connecting…');
    try {
      const r = await fetch(`${DMT_BASE}/remote-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId || undefined,
          host: form.host, type: form.type, port: form.port,
          username: form.username, password: form.password,
          domain: form.domain, security: form.security,
          ...getInitialResolution(),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const { token } = await r.json();
      openSession(token, form.name || form.host, form.type);
    } catch (err) {
      setStatus(`Failed: ${err.message}`);
      setConnecting(false);
    }
  }

  async function handleConnectSaved(conn) {
    handleDisconnect();
    if (!conn.hasPassword) {
      selectConnection(conn);
      setStatus('No password saved — enter one below and click Connect.');
      return;
    }
    setConnecting(true);
    setStatus('Connecting…');
    try {
      const r = await fetch(`${DMT_BASE}/remote-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conn.id, ...getInitialResolution() }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const { token } = await r.json();
      openSession(token, conn.name, conn.type);
    } catch (err) {
      selectConnection(conn);
      setStatus(`Connect failed: ${err.message}`);
      setConnecting(false);
    }
  }

  // After sessionActive flips true, the display div is in the DOM — attach guacamole here
  useEffect(() => {
    if (!sessionActive || !pendingTokenRef.current) return;
    const token = pendingTokenRef.current;
    pendingTokenRef.current = null;
    if (!displayRef.current) return;

    const tunnel = new Guacamole.WebSocketTunnel(`ws://localhost:7000/?token=${encodeURIComponent(token)}`);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    const displayEl = client.getDisplay().getElement();
    displayRef.current.innerHTML = '';
    displayRef.current.appendChild(displayEl);

    // When remote reports a resize, scale to fill the container
    client.getDisplay().onresize = (w, h) => {
      if (!displayRef.current || !w || !h) return;
      const scale = Math.min(
        displayRef.current.clientWidth / w,
        displayRef.current.clientHeight / h,
        1
      );
      displayScaleRef.current = scale;
      client.getDisplay().scale(scale);
    };

    // Send the container's actual pixel size to the remote
    const sendCurrentSize = () => {
      if (!displayRef.current) return;
      const { clientWidth: w, clientHeight: h } = displayRef.current;
      if (w && h) client.sendSize(w, h);
    };

    // Debounced ResizeObserver — fires whenever the container changes size
    let resizeTimer = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sendCurrentSize, 120);
    });
    ro.observe(displayRef.current);

    // Capture-phase listener on document so the combo works even when the canvas
    // isn't focused (e.g. after clicking the ☰ button in the header).
    const forwarded = new Set();
    const handleSidebarToggle = e => {
      if (!e.ctrlKey || !e.altKey || !e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation(); // prevents Guacamole keyboard from also seeing this keydown
      // Release any modifier keys that were already forwarded to the remote
      for (const k of [65507, 65508, 65513, 65514, 65505, 65506]) {
        if (forwarded.has(k)) { client.sendKeyEvent(0, k); forwarded.delete(k); }
      }
      setSidebarOpen(v => !v);
    };
    document.addEventListener('keydown', handleSidebarToggle, { capture: true });

    const keyboard = new Guacamole.Keyboard(displayRef.current);
    keyboard.onkeydown = k => { forwarded.add(k); client.sendKeyEvent(1, k); };
    keyboard.onkeyup = k => {
      if (forwarded.has(k)) { forwarded.delete(k); client.sendKeyEvent(0, k); }
    };
    keyboardRef.current = keyboard;

    const mouse = new Guacamole.Mouse(displayEl);
    const sendMouse = state => {
      const s = displayScaleRef.current;
      if (s === 1 || s === 0) { client.sendMouseState(state); return; }
      client.sendMouseState(new Guacamole.Mouse.State(
        Math.round(state.x / s), Math.round(state.y / s),
        state.left, state.middle, state.right, state.up, state.down
      ));
    };
    mouse.onmousedown = sendMouse;
    mouse.onmouseup = sendMouse;
    mouse.onmousemove = sendMouse;
    mouse.onmouseout = sendMouse;

    let wasOpen = false;
    tunnel.onstatechange = state => {
      if (state === Guacamole.Tunnel.State.OPEN) {
        wasOpen = true;
        sendCurrentSize(); // snap to actual container size as soon as the channel is live
      } else if (state === Guacamole.Tunnel.State.CLOSED) {
        // Only show generic close if a specific error hasn't already been set
        setStatus(prev => (prev && prev !== 'Connecting…' && prev !== '') ? prev
          : wasOpen ? 'Disconnected.' : 'Connection refused — check guacd and target host.');
      }
    };
    tunnel.onerror = status => {
      const code = status?.code ?? '';
      const CODES = { 0x0202: 'upstream timeout', 0x0203: 'upstream error', 0x0207: 'upstream not found (host unreachable, RDP disabled, or security mismatch)', 0x0208: 'upstream unavailable' };
      const label = CODES[code] || (status?.message && typeof status.message === 'string' ? status.message : `code ${code}`);
      setStatus(`Connection error: ${label}`);
    };
    client.onerror = err => {
      const code = err?.code ? ` [${err.code}]` : '';
      setStatus(`Remote error${code}: ${err?.message || String(err)}`);
    };

    client.connect();
    displayRef.current.focus();

    return () => {
      ro.disconnect();
      clearTimeout(resizeTimer);
      document.removeEventListener('keydown', handleSidebarToggle, { capture: true });
    };
  }, [sessionActive]); // eslint-disable-line react-hooks/exhaustive-deps

  function openSession(token, name, type) {
    disconnectClient();
    pendingTokenRef.current = token;
    setSessionActive(true);
    setSessionName(`${name} (${type.toUpperCase()})`);
    setPanelOpen(false);
    setConnecting(false);
    setStatus('');
  }

  function disconnectClient() {
    if (keyboardRef.current) {
      keyboardRef.current.onkeydown = null;
      keyboardRef.current.onkeyup = null;
      try { keyboardRef.current.reset(); } catch {}
      keyboardRef.current = null;
    }
    if (clientRef.current) {
      try { clientRef.current.disconnect(); } catch {}
      clientRef.current = null;
    }
  }

  function handleDisconnect() {
    disconnectClient();
    setSessionActive(false);
    setSessionName('');
    setStatus('');
    setConnecting(false);
  }

  async function handleDelete(e, id) {
    e.stopPropagation();
    try {
      await fetch(`${DMT_BASE}/remote-connections/${id}`, { method: 'DELETE' });
      await loadConnections();
      if (editingId === id) clearForm();
    } catch {}
  }

  async function handleDiagnose() {
    setDiagLoading(true);
    setDiagResult(null);
    try {
      const r = await fetch(`${DMT_BASE}/test-guac`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`Server returned ${r.status} — sync to WSL first`);
      const result = await r.json();

      // If a host is filled in, also test TCP reachability from inside WSL
      if (form.host.trim()) {
        try {
          const cr = await fetch(`${DMT_BASE}/test-connectivity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host: form.host.trim(), port: form.port || DEFAULT_PORTS[form.type] }),
            signal: AbortSignal.timeout(6000),
          });
          result.connectivity = await cr.json();
        } catch {
          result.connectivity = { reachable: false, reason: 'connectivity check timed out' };
        }
      }

      setDiagResult(result);

      // Also fetch guacd logs
      try {
        const lr = await fetch(`${DMT_BASE}/guac-logs`, { signal: AbortSignal.timeout(4000) });
        setGuacLogs(await lr.text());
      } catch {
        setGuacLogs('(could not fetch logs)');
      }
    } catch (err) {
      setDiagResult({ error: err.name === 'TimeoutError'
        ? 'Timed out — sync app.js to WSL then restart DMT Tools'
        : err.message });
    } finally {
      setDiagLoading(false);
    }
  }

  // ── Loading / unavailable states ─────────────────────────────────────────────

  if (dmtReady === null) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400">
        Checking DMT Tools…
      </div>
    );
  }

  if (!dmtReady) {
    const isSpinning = autoPhase === 'launching' || autoPhase === 'waiting';
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-8 text-center">
        {isSpinning
          ? <Loader2 size={36} className="text-blue-400 animate-spin" />
          : <MonitorPlay size={36} className="text-gray-300" />
        }

        {autoPhase === 'launching' && (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Starting DMT Tools{wslInstance ? ` in ${wslInstance}` : ''}…
          </p>
        )}
        {autoPhase === 'waiting' && (
          <>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
              Waiting for DMT Tools to come up…
            </p>
            <p className="text-xs text-gray-400">This takes 10–20 s on first launch.</p>
          </>
        )}
        {autoPhase === 'needs-setup' && (
          <>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">DMT Tools isn't set up yet.</p>
            <p className="text-xs text-gray-400 max-w-xs">
              Open the <strong>DMT Tools</strong> tab, pick a WSL instance, and run <strong>Setup</strong>. Come back here when it's done.
            </p>
            <button
              onClick={() => kickAutoLaunch(wslInstance)}
              className="mt-1 px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Retry
            </button>
          </>
        )}
        {(autoPhase === 'failed' || autoPhase === 'idle') && (
          <>
            <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Couldn't start DMT Tools automatically.</p>
            {wslInstances.length > 1 && (
              <select
                value={wslInstance}
                onChange={e => setWslInstance(e.target.value)}
                className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800"
                style={{ color: 'var(--text)' }}
              >
                {wslInstances.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => kickAutoLaunch(wslInstance)}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Retry
              </button>
              <button
                onClick={() => setRetryCount(c => c + 1)}
                className="px-4 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800"
                style={{ color: 'var(--text)' }}
              >
                Just check
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Grouped connections ───────────────────────────────────────────────────────

  const grouped = CONN_TYPES.reduce((acc, t) => {
    acc[t] = connections.filter(c => c.type === t);
    return acc;
  }, {});

  // ── Session view ─────────────────────────────────────────────────────────────

  if (sessionActive) {
    return (
      <div className="flex flex-col h-full" style={{ background: '#000' }}>
        {/* Session header */}
        <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-900 border-b border-gray-700 shrink-0">
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded"
          >
            <PlugZap size={12} /> Disconnect
          </button>
          <span className="text-xs text-gray-300">{sessionName}</span>
          {status && (
            <span className="text-xs text-yellow-400 ml-2">{status}</span>
          )}
          <div className="flex-1" />
          <button
            onClick={() => setSidebarOpen(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-200 p-1 rounded"
            title="Menu (Ctrl+Alt+Shift)"
          >
            <Menu size={14} />
          </button>
          <button
            onClick={() => setPanelOpen(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
          >
            {panelOpen ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
            Connections
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden relative">
          {/* Canvas */}
          <div
            ref={displayRef}
            tabIndex={0}
            className="flex-1 overflow-hidden outline-none cursor-none"
            style={{ background: '#000' }}
          />

          {sidebarOpen && (
            <GuacSidebar
              clientRef={clientRef}
              onClose={() => setSidebarOpen(false)}
              onDisconnect={handleDisconnect}
            />
          )}

          {/* Connections panel */}
          {panelOpen && (
            <ConnectionsPanel
              grouped={grouped}
              editingId={editingId}
              connecting={connecting}
              onConnect={handleConnectSaved}
              onSelect={selectConnection}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>
    );
  }

  // ── Manager view ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--content-bg)' }}>

      {/* Left — connection form */}
      <div className="flex-1 overflow-auto p-6 min-w-0">
        <div className="max-w-lg">
          <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--text-h)' }}>
            {editingId ? 'Edit Connection' : 'Connect'}
          </h2>

          {/* Type selector */}
          <div className="flex gap-1 mb-4">
            {CONN_TYPES.map(t => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                  form.type === t
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-blue-400'
                }`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Form grid */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Field label="Host / IP" half={false}>
              <div className="grid grid-cols-[1fr_100px] gap-2">
                <Input placeholder="192.168.1.100" value={form.host} onChange={e => setField('host', e.target.value)} />
                <Input placeholder="Port" value={form.port} onChange={e => setField('port', e.target.value)} />
              </div>
            </Field>

            <Field label="Username" half>
              <Input
                placeholder={form.type === 'vnc' ? 'Username (optional)' : 'Username'}
                value={form.username}
                onChange={e => setField('username', e.target.value)}
              />
            </Field>
            <Field label="Password" half>
              <Input
                type="password"
                placeholder={editingId ? 'Leave blank to keep saved' : 'Password'}
                value={form.password}
                onChange={e => setField('password', e.target.value)}
              />
            </Field>

            {form.type === 'rdp' && (
              <>
                <Field label="Domain (optional)" half>
                  <Input placeholder="CORP" value={form.domain} onChange={e => setField('domain', e.target.value)} />
                </Field>
                <Field label="Security" half>
                  <select
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={form.security}
                    onChange={e => setField('security', e.target.value)}
                  >
                    <option value="any">Any (auto)</option>
                    <option value="nla">NLA (recommended)</option>
                    <option value="nla-ext">NLA extended</option>
                    <option value="tls">TLS</option>
                    <option value="rdp">RDP (legacy)</option>
                    <option value="vmconnect">Hyper-V</option>
                  </select>
                </Field>
              </>
            )}

            {form.type !== 'ssh' && (
              <>
                <Field label="Width (px)" half>
                  <Input placeholder="1920" value={form.width} onChange={e => setField('width', e.target.value)} />
                </Field>
                <Field label="Height (px)" half>
                  <Input placeholder="1080" value={form.height} onChange={e => setField('height', e.target.value)} />
                </Field>
              </>
            )}

            <Field label="Connection name (to save)" half={false}>
              <Input
                placeholder="e.g. Dev Server"
                value={form.name}
                onChange={e => setField('name', e.target.value)}
              />
            </Field>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleConnect}
              disabled={!form.host.trim() || connecting}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md"
            >
              <Plug size={13} />
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
            <button
              onClick={handleSave}
              disabled={!form.name.trim() || !form.host.trim() || saving}
              className="px-4 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              style={{ color: 'var(--text)' }}
            >
              {saving ? 'Saving…' : editingId ? 'Update' : 'Save'}
            </button>
            {editingId && (
              <button
                onClick={clearForm}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                + New
              </button>
            )}
          </div>

          {status && (
            <p className={`mt-3 text-xs ${
              status.includes('failed') || status.includes('Failed') || status.includes('required') || status.includes('Error') || status.includes('refused')
                ? 'text-red-500' : 'text-green-600 dark:text-green-400'
            }`}>
              {status}
            </p>
          )}

          {/* Diagnose button */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleDiagnose}
              disabled={diagLoading}
              className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              style={{ color: 'var(--muted)' }}
            >
              {diagLoading ? 'Checking…' : 'Diagnose'}
            </button>
            {diagResult && (
              <div className="mt-2 text-xs space-y-0.5 font-mono">
                {diagResult.error && !diagResult.guacdRunning && !diagResult.cryptoOk ? (
                  <div className="text-red-500">{diagResult.error}</div>
                ) : (<>
                  <div className={diagResult.guacdRunning ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                    guacd: {diagResult.guacdRunning ? 'running' : 'NOT running — run Setup in DMT Tools'}
                    {diagResult.guacdVersion ? ` (${diagResult.guacdVersion})` : ''}
                  </div>
                  <div className={diagResult.rdpPlugin && diagResult.rdpPlugin !== 'not found' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                    rdp plugin: {diagResult.rdpPlugin || '…'}
                    {diagResult.rdpPlugin === 'not found' ? ' — run Setup in DMT Tools to install' : ''}
                  </div>
                  <div className={diagResult.cryptoOk ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                    crypto: {diagResult.cryptoOk ? `ok (keyLen=${diagResult.keyLength})` : `FAILED — ${diagResult.error}`}
                  </div>
                  {diagResult.connectivity && (
                    <>
                      <div className={diagResult.connectivity.reachable ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                        {form.host}:{form.port} → {diagResult.connectivity.reachable
                          ? 'reachable from WSL'
                          : `NOT reachable from WSL — ${diagResult.connectivity.reason}`}
                      </div>
                      {!diagResult.connectivity.reachable && (
                        <div className="text-yellow-600 dark:text-yellow-400 whitespace-normal leading-relaxed pt-1" style={{ fontFamily: 'inherit' }}>
                          Tip: guacd runs inside WSL2 which uses a virtual network. Add <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">networkingMode=mirrored</code> to <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">%USERPROFILE%\.wslconfig</code> then run <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">wsl --shutdown</code>.
                        </div>
                      )}
                    </>
                  )}
                  {guacLogs && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 select-none">guacd log ▸</summary>
                      <pre className="mt-1 text-[10px] leading-tight overflow-auto max-h-48 p-2 rounded bg-gray-100 dark:bg-gray-800 whitespace-pre-wrap break-all" style={{ color: 'var(--text)' }}>{guacLogs}</pre>
                    </details>
                  )}
                </>)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Toggle button (always visible) */}
      <button
        onClick={() => setPanelOpen(v => !v)}
        className="shrink-0 flex items-center self-stretch px-1 border-l border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        title={panelOpen ? 'Hide connections' : 'Show saved connections'}
      >
        {panelOpen ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>

      {/* Right — saved connections panel */}
      {panelOpen && (
        <ConnectionsPanel
          grouped={grouped}
          editingId={editingId}
          connecting={connecting}
          onConnect={handleConnectSaved}
          onSelect={selectConnection}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

// ── Guacamole sidebar menu ────────────────────────────────────────────────────

function GuacSidebar({ clientRef, onClose, onDisconnect }) {
  const [clipText, setClipText] = useState('');

  function sendClipboard() {
    const client = clientRef.current;
    if (!client || !clipText) return;
    const stream = client.createClipboardStream('text/plain');
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(clipText);
    writer.sendEnd();
    setClipText('');
  }

  function sendCombo(...keysyms) {
    const client = clientRef.current;
    if (!client) return;
    for (const k of keysyms) client.sendKeyEvent(1, k);
    for (const k of [...keysyms].reverse()) client.sendKeyEvent(0, k);
  }

  return (
    <div
      className="absolute left-0 top-0 bottom-0 w-64 flex flex-col z-50 shadow-2xl"
      style={{ background: 'rgba(17,24,39,0.96)', borderRight: '1px solid rgba(255,255,255,0.1)' }}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/10 shrink-0">
        <span className="text-xs font-semibold text-gray-200">Remote Menu</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white p-0.5 rounded">
          <X size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Clipboard</div>
          <textarea
            className="w-full h-20 bg-gray-800 text-gray-100 text-xs rounded border border-gray-600 p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Paste text here to send to remote…"
            value={clipText}
            onChange={e => setClipText(e.target.value)}
          />
          <button
            onClick={sendClipboard}
            disabled={!clipText}
            className="mt-1.5 w-full py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded"
          >
            Send to Remote
          </button>
        </div>

        <div>
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Special Keys</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => sendCombo(65507, 65513, 65535)}
              className="py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            >
              Ctrl+Alt+Del
            </button>
            <button
              onClick={() => sendCombo(65515)}
              className="py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            >
              Win key
            </button>
            <button
              onClick={() => sendCombo(65377)}
              className="py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            >
              Print Screen
            </button>
            <button
              onClick={() => sendCombo(65299)}
              className="py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            >
              Pause/Break
            </button>
          </div>
        </div>
      </div>

      <div className="px-3 py-3 border-t border-white/10 space-y-2 shrink-0">
        <button
          onClick={onDisconnect}
          className="w-full py-1.5 text-xs font-medium bg-red-700 hover:bg-red-600 text-white rounded flex items-center justify-center gap-1.5"
        >
          <PlugZap size={11} /> Disconnect
        </button>
        <p className="text-center text-[10px] text-gray-600">Ctrl+Alt+Shift to toggle</p>
      </div>
    </div>
  );
}

// ── Saved connections panel ───────────────────────────────────────────────────

function ConnectionsPanel({ grouped, editingId, connecting, onConnect, onSelect, onDelete }) {
  const hasAny = Object.values(grouped).some(g => g.length > 0);

  return (
    <div className="w-72 shrink-0 border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden" style={{ background: 'var(--panel-bg, #f9fafb)' }}>
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Saved Connections</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {!hasAny && (
          <p className="text-xs text-gray-400 px-2 pt-2">No saved connections yet.</p>
        )}

        {CONN_TYPES.filter(t => grouped[t]?.length > 0).map(type => (
          <div key={type} className="mb-3">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              {type}
            </div>
            {grouped[type].map(conn => {
              const isSelected = editingId === conn.id;
              return (
                <div
                  key={conn.id}
                  onClick={() => onSelect(conn)}
                  className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer mb-0.5 group ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-300 dark:ring-blue-600'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text)' }}>{conn.name}</div>
                    <div className="text-[10px] text-gray-400 font-mono truncate">{conn.host}:{conn.port}</div>
                  </div>
                  {conn.hasPassword && (
                    <span className="text-[9px] text-green-500 shrink-0" title="Password saved">●</span>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); onConnect(conn); }}
                    disabled={connecting}
                    className="shrink-0 px-2 py-0.5 text-[10px] font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded"
                  >
                    ↗
                  </button>
                  <button
                    onClick={e => onDelete(e, conn.id)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500"
                    title="Delete"
                  >
                    <X size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
