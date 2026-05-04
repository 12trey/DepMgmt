import { useState, useEffect, useRef, useCallback } from 'react';
import Guacamole from 'guacamole-common-js';
import { MonitorPlay, ChevronRight, ChevronLeft, X, Plug, PlugZap, Loader2, Menu, Maximize2, Minimize2 } from 'lucide-react';

const DMT_BASE = 'http://localhost:7000';
const CONN_TYPES = ['rdp', 'vnc', 'ssh'];
const DEFAULT_PORTS = { rdp: '3389', vnc: '5900', ssh: '22' };
const EMPTY_FORM = { name: '', type: 'rdp', host: '', port: '3389', username: '', password: '', domain: '', security: 'nla' };
const WSL_INSTANCE_KEY = 'dmt-wsl-instance';

// Estimate the pixel area the remote session canvas will actually occupy.
// Called at connect-time so the initial RDP resolution matches the container —
// avoiding the CSS-scale-then-snap jump that happens when sendSize fires later.
function getInitialResolution() {
  const navCollapsed = localStorage.getItem('navCollapsed') === 'true';
  const sidebarW = navCollapsed ? 56 : 224;  // matches App.jsx w-14 / w-56
  const w = window.innerWidth  - sidebarW;
  const h = window.innerHeight - 38          // app tab bar
                               - 28          // session tab bar
                               - 34;         // session toolbar
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
  const [fullscreen, setFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  // Multi-tab session state
  const [sessionTabs, setSessionTabs] = useState([]); // [{ id, name }]
  const [activeId, setActiveId] = useState(null);
  const [status, setStatus] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [diagResult, setDiagResult] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [guacLogs, setGuacLogs] = useState(null);
  const [autoPhase, setAutoPhase] = useState('idle'); // idle|launching|waiting|failed|needs-setup
  const [wslInstances, setWslInstances] = useState([]);
  const [wslInstance, setWslInstance] = useState(() => localStorage.getItem(WSL_INSTANCE_KEY) || '');

  const [newConnect, setNewConnect] = useState(false);

  const displayRef    = useRef(null);
  const clientRef     = useRef(null); // always points to the active session's client
  const keyboardRef   = useRef(null);
  const displayScaleRef = useRef(1);
  const autoLaunchedRef = useRef(false);
  // id → { client, tunnel, displayEl, mouse, displayScale }
  const sessionsRef   = useRef(new Map());
  const activeIdRef   = useRef(null);   // sync copy of activeId for use inside closures
  const forwardedRef  = useRef(new Set()); // keys forwarded to current remote
  const sessionViewRef    = useRef(null);
  const hudTimerRef       = useRef(null);
  const inTriggerZoneRef  = useRef(false);
  const hudRef            = useRef(null);

  // Keep activeIdRef in sync with React state
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // Sync React fullscreen state with Electron native fullscreen (F11 or external trigger)
  useEffect(() => {
    if (!window.electronAPI?.onFullscreenChanged) return;
    window.electronAPI.onFullscreenChanged(flag => {
      setFullscreen(flag);
      if (!flag) { setHudVisible(false); clearTimeout(hudTimerRef.current); }
    });
  }, []);

  // Close fullscreen on Escape
  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape' && fullscreen) {
        setFullscreen(false);
        setHudVisible(false);
        clearTimeout(hudTimerRef.current);
        window.electronAPI?.setFullscreen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Reveal HUD when mouse is near the top of the screen in fullscreen.
  // Capture phase bypasses Guacamole.Mouse's stopPropagation on mouse events.
  useEffect(() => {
    if (!fullscreen) { inTriggerZoneRef.current = false; return; }
    const handler = e => {
      const hudW = hudRef.current?.offsetWidth ?? 0;
      const hudLeft = (window.innerWidth - hudW) / 2;
      const inZone = e.clientY < 1 && e.clientX >= hudLeft && e.clientX <= hudLeft + hudW;
      if (inZone) { setHudVisible(true); clearTimeout(hudTimerRef.current); }
      else if (inTriggerZoneRef.current) { hudTimerRef.current = setTimeout(() => setHudVisible(false), 2500); }
      inTriggerZoneRef.current = inZone;
    };
    document.addEventListener('mousemove', handler, { capture: true, passive: true });
    return () => { document.removeEventListener('mousemove', handler, { capture: true }); inTriggerZoneRef.current = false; };
  }, [fullscreen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check DMT Tools and load saved connections
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

  // Disconnect all sessions on unmount
  useEffect(() => () => {
    for (const { client } of sessionsRef.current.values()) {
      try { client.disconnect(); } catch {}
    }
  }, []);

  // Auto-launch DMT Tools the moment we detect it isn't running
  useEffect(() => {
    if (dmtReady !== false || autoLaunchedRef.current) return;
    autoLaunchedRef.current = true;
    kickAutoLaunch(localStorage.getItem(WSL_INSTANCE_KEY) || '');
  }, [dmtReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Set up keyboard + ResizeObserver once when the first session opens;
  // tear down when the last session closes.
  const hasSession = sessionTabs.length > 0;
  useEffect(() => {
    if (!hasSession || !displayRef.current) return;

    const sendCurrentSize = () => {
      const el = displayRef.current;
      const client = clientRef.current;
      if (!el || !client) return;
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      client.sendSize(w, h);
      // CSS-scale to fill container for servers that ignore resize (e.g. most VNC)
      const dw = client.getDisplay().getWidth();
      const dh = client.getDisplay().getHeight();
      if (dw && dh) {
        const scale = Math.min(w / dw, h / dh);
        client.getDisplay().scale(scale);
        const sess = sessionsRef.current.get(activeIdRef.current);
        if (sess) { sess.displayScale = scale; displayScaleRef.current = scale; }
      }
    };

    let resizeTimer = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(sendCurrentSize, 120);
    });
    ro.observe(displayRef.current);

    const forwarded = forwardedRef.current;
    const handleSidebarToggle = e => {
      if (!e.ctrlKey || !e.altKey || !e.shiftKey) return;
      e.preventDefault();
      e.stopPropagation();
      const client = clientRef.current;
      if (client) {
        for (const k of [65507, 65508, 65513, 65514, 65505, 65506]) {
          if (forwarded.has(k)) { client.sendKeyEvent(0, k); forwarded.delete(k); }
        }
      }
      setSidebarOpen(v => !v);
    };
    document.addEventListener('keydown', handleSidebarToggle, { capture: true });

    const keyboard = new Guacamole.Keyboard(displayRef.current);
    keyboard.onkeydown = k => {
      const client = clientRef.current;
      if (!client) return;
      forwarded.add(k);
      client.sendKeyEvent(1, k);
    };
    keyboard.onkeyup = k => {
      const client = clientRef.current;
      if (!client) return;
      if (forwarded.has(k)) { forwarded.delete(k); client.sendKeyEvent(0, k); }
    };
    keyboardRef.current = keyboard;

    // When a focused element (HUD button, sidebar button, etc.) is removed from the DOM,
    // the browser moves focus to document.body. Detect that and restore focus to the
    // display so keyboard input keeps working without the user having to click.
    const onDocFocusOut = () => {
      setTimeout(() => {
        const a = document.activeElement;
        if (!a || a === document.body || a === document.documentElement) {
          displayRef.current?.focus();
        }
      }, 0);
    };
    document.addEventListener('focusout', onDocFocusOut);

    return () => {
      ro.disconnect();
      clearTimeout(resizeTimer);
      document.removeEventListener('keydown', handleSidebarToggle, { capture: true });
      document.removeEventListener('focusout', onDocFocusOut);
      if (keyboardRef.current) {
        keyboardRef.current.onkeydown = null;
        keyboardRef.current.onkeyup = null;
        keyboardRef.current = null;
      }
    };
  }, [hasSession]); // eslint-disable-line react-hooks/exhaustive-deps

  // Swap display element into the container whenever the active tab changes
  useEffect(() => {
    if (!activeId || !displayRef.current) return;
    const session = sessionsRef.current.get(activeId);
    if (!session) return;

    displayRef.current.innerHTML = '';
    displayRef.current.appendChild(session.displayEl);
    clientRef.current = session.client;
    displayScaleRef.current = session.displayScale;
    forwardedRef.current.clear();

    const { clientWidth: w, clientHeight: h } = displayRef.current;
    if (w && h) session.client.sendSize(w, h);

    // Re-apply CSS scale (ensures VNC sessions fill the container on tab switch)
    const dw = session.client.getDisplay().getWidth();
    const dh = session.client.getDisplay().getHeight();
    if (dw && dh && w && h) {
      const scale = Math.min(w / dw, h / dh);
      session.client.getDisplay().scale(scale);
      session.displayScale = scale;
      displayScaleRef.current = scale;
    }

    displayRef.current.focus();
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

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
      security: conn.security || 'nla',
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
    setNewConnect(false);
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

  function openSession(token, name, type) {
    const id = crypto.randomUUID();
    const tabName = `${name} (${type.toUpperCase()})`;

    const tunnel = new Guacamole.WebSocketTunnel(`ws://localhost:7000/?token=${encodeURIComponent(token)}`);
    const client = new Guacamole.Client(tunnel);
    const displayEl = client.getDisplay().getElement();

    client.getDisplay().onresize = (w, h) => {
      const sess = sessionsRef.current.get(id);
      if (!sess || !displayRef.current || !w || !h) return;
      const scale = Math.min(displayRef.current.clientWidth / w, displayRef.current.clientHeight / h);
      sess.displayScale = scale;
      client.getDisplay().scale(scale);
      if (activeIdRef.current === id) displayScaleRef.current = scale;
    };

    const mouse = new Guacamole.Mouse(displayEl);
    const sendMouse = state => {
      const sess = sessionsRef.current.get(id);
      const s = sess?.displayScale ?? 1;
      if (s === 1 || s === 0) { client.sendMouseState(state); return; }
      client.sendMouseState(new Guacamole.Mouse.State(
        Math.round(state.x / s), Math.round(state.y / s),
        state.left, state.middle, state.right, state.up, state.down
      ));
    };
    mouse.onmousedown = sendMouse;
    mouse.onmouseup  = sendMouse;
    mouse.onmousemove = sendMouse;
    mouse.onmouseout  = sendMouse;

    let wasOpen = false;
    tunnel.onstatechange = state => {
      if (state === Guacamole.Tunnel.State.OPEN) {
        wasOpen = true;
        // Send size once the channel is live (works for both active and background tabs)
        if (displayRef.current && activeIdRef.current === id) {
          const { clientWidth: w, clientHeight: h } = displayRef.current;
          if (w && h) client.sendSize(w, h);
        }
      } else if (state === Guacamole.Tunnel.State.CLOSED) {
        if (activeIdRef.current === id) {
          setStatus(prev => (prev && prev !== 'Connecting…' && prev !== '') ? prev
            : wasOpen ? 'Disconnected.' : 'Connection refused — check guacd and target host.');

          //if(status==='Disconnected') {
            disconnectSession(id);
          //}
        }
      }
    };
    tunnel.onerror = s => {
      if (activeIdRef.current !== id) return;
      const code = s?.code ?? '';
      const CODES = { 0x0202: 'upstream timeout', 0x0203: 'upstream error', 0x0207: 'upstream not found (host unreachable, RDP disabled, or security mismatch)', 0x0208: 'upstream unavailable' };
      const label = CODES[code] || (s?.message && typeof s.message === 'string' ? s.message : `code ${code}`);
      setStatus(`Connection error: ${label}`);
    };
    client.onerror = err => {
      if (activeIdRef.current !== id) return;
      const code = err?.code ? ` [${err.code}]` : '';
      setStatus(`Remote error${code}: ${err?.message || String(err)}`);
    };

    sessionsRef.current.set(id, { client, tunnel, displayEl, mouse, displayScale: 1 });
    setSessionTabs(prev => [...prev, { id, name: tabName }]);
    setActiveId(id);
    setPanelOpen(false);
    setConnecting(false);
    setStatus('');

    client.connect();
  }

  function disconnectSession(id) {
    const session = sessionsRef.current.get(id);
    if (session) {
      try { session.client.disconnect(); } catch {}
      sessionsRef.current.delete(id);
    }

    const remaining = sessionTabs.filter(t => t.id !== id);
    setSessionTabs(remaining);

    if (activeIdRef.current === id) {
      const newActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      setActiveId(newActive);
      setStatus('');
      setSidebarOpen(false);
      setNewConnect(false);
      if (newActive === null) setPanelOpen(true);
    }
  }

  function switchTab(id) {
    if (id === activeId) return;
    setActiveId(id);
    setStatus('');
    setSidebarOpen(false);
    setNewConnect(false);
  }

  function enterFullscreen() {
    setFullscreen(true);
    window.electronAPI?.setFullscreen(true);
  }
  function exitFullscreen() {
    setFullscreen(false);
    setHudVisible(false);
    clearTimeout(hudTimerRef.current);
    window.electronAPI?.setFullscreen(false);
  }
  function showHud() {
    setHudVisible(true);
    clearTimeout(hudTimerRef.current);
  }
  function scheduleHideHud() {
    hudTimerRef.current = setTimeout(() => setHudVisible(false), 2500);
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

  // ── Session view (one or more active tabs) ────────────────────────────────────

  function ShowManager() {
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

  if (hasSession) {
    const activeTab = sessionTabs.find(t => t.id === activeId);
    return (
      <div
        ref={sessionViewRef}
        className={`flex flex-col ${fullscreen ? '' : 'h-full'}`}
        style={{ background: '#000', ...(fullscreen ? { position: 'fixed', inset: 0, zIndex: 50 } : {}) }}
      >

        {/* Tab bar — hidden in fullscreen */}
        {!fullscreen && (
          <div className="flex items-center bg-gray-800 border-b border-gray-700 shrink-0 overflow-x-auto">
            {sessionTabs.map(tab => (
              <div
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs shrink-0 cursor-pointer border-r border-gray-700 select-none ${
                  tab.id === activeId
                    ? 'bg-gray-900 text-gray-100'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                }`}
              >
                <span className="max-w-[140px] truncate">{tab.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); disconnectSession(tab.id); }}
                  className="shrink-0 text-gray-500 hover:text-red-400 rounded p-0.5"
                  title="Disconnect"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            <button
              onClick={() => { if (!newConnect) clearForm(); setNewConnect(n => !n); }}
              className="ml-auto flex items-center gap-1 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 shrink-0"
              title="Open a new connection"
            >
              {newConnect ? 'Cancel' : 'New'}
            </button>
          </div>
        )}

        {/* Toolbar — hidden in fullscreen */}
        {!fullscreen && (
          <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-900 border-b border-gray-700 shrink-0">
            <span className="text-xs text-gray-400 truncate max-w-xs">{activeTab?.name ?? ''}</span>
            {status && <span className="text-xs text-yellow-400 truncate">{status}</span>}
            <div className="flex-1" />
            <button
              onClick={() => setSidebarOpen(v => !v)}
              className="text-xs text-gray-400 hover:text-gray-200 p-1 rounded"
              title="Menu (Ctrl+Alt+Shift)"
            >
              <Menu size={14} />
            </button>
            <button
              onClick={enterFullscreen}
              className="text-xs text-gray-400 hover:text-gray-200 p-1 rounded"
              title="Fullscreen"
            >
              <Maximize2 size={13} />
            </button>
            <button
              onClick={() => setPanelOpen(v => !v)}
              className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
            >
              {panelOpen ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
              Connections
            </button>
          </div>
        )}

        {/* Canvas + overlays */}
        <div className="flex flex-1 overflow-hidden relative">
          <div
            ref={displayRef}
            tabIndex={0}
            className="flex-1 overflow-hidden outline-none cursor-none flex items-center justify-center"
            style={{ background: '#000', ...newConnect ? { display: 'none' } : {} }}
          />          
          
          {sidebarOpen && !newConnect && (
            <GuacSidebar
              clientRef={clientRef}
              onClose={() => setSidebarOpen(false)}
              onDisconnect={() => disconnectSession(activeId)}
            />
          )}

          {panelOpen && !fullscreen && !newConnect && (
            <ConnectionsPanel
              grouped={grouped}
              editingId={editingId}
              connecting={connecting}
              onConnect={handleConnectSaved}
              onSelect={selectConnection}
              onDelete={handleDelete}
            />
          )}

          {/* Fullscreen HUD — slides down from top-center on mouse proximity */}
          {fullscreen && (
            <div
              ref={hudRef}
              onMouseEnter={showHud}
              onMouseLeave={scheduleHideHud}
              style={{
                position: 'fixed',
                top: 0,
                left: '50%',
                transform: `translateX(-50%) translateY(${hudVisible ? '0' : '-100%'})`,
                transition: 'transform 0.2s ease-out',
                zIndex: 99,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '8px 20px',
                background: 'rgba(17,24,39,0.92)',
                backdropFilter: 'blur(10px)',
                borderRadius: '0 0 10px 10px',
                border: '1px solid rgba(255,255,255,0.12)',
                borderTop: 'none',
                cursor: 'default',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
              }}
            >
              <span style={{ fontSize: 12, color: '#d1d5db' }}>{activeTab?.name ?? ''}</span>
              {status && <span style={{ fontSize: 11, color: '#facc15' }}>{status}</span>}
              <span style={{ fontSize: 10, color: '#4b5563' }}>Ctrl+Alt+Shift for menu</span>
              <button
                onClick={exitFullscreen}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  fontSize: 11, color: '#9ca3af', background: 'none',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5,
                  padding: '3px 10px', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}
              >
                <Minimize2 size={11} /> Exit Fullscreen
              </button>
            </div>
          )}
        </div>

        {newConnect && ShowManager()}
      </div>
    );
  }

  // ── Manager view ─────────────────────────────────────────────────────────────
  return ShowManager();
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
