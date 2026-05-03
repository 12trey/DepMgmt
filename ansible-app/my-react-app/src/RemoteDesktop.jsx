import { useState, useEffect, useRef } from 'react';
import Guacamole from 'guacamole-common-js';

const BASE = 'http://localhost:7000';
const DEFAULT_PORTS = { rdp: '3389', vnc: '5900', ssh: '22' };
const CONN_TYPES = ['rdp', 'vnc', 'ssh'];

const EMPTY_FORM = { name: '', type: 'rdp', host: '', port: '3389', username: '', password: '', domain: '', width: '1920', height: '1080' };

export default function RemoteDesktop() {
  const [connections, setConnections] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [view, setView] = useState('manager');
  const [sessionName, setSessionName] = useState('');
  const [status, setStatus] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const displayRef = useRef(null);
  const clientRef = useRef(null);
  const keyboardRef = useRef(null);

  useEffect(() => { loadConnections(); }, []);

  useEffect(() => () => { disconnectClient(); }, []);

  useEffect(() => {
    if (!clientRef.current || !displayRef.current) return;

    let resizeTimeout;

    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const el = displayRef.current;
        const client = clientRef.current;
        if (!el || !client) return;

        client.sendSize(el.clientWidth, el.clientHeight);
      }, 100);
    };

    // Run once initially
    handleResize();

    // Listen for window resize
    window.addEventListener('resize', handleResize);

    // Optional: observe container resize (better than window resize)
    const observer = new ResizeObserver(handleResize);
    observer.observe(displayRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [view]); // or whatever indicates session is active

  async function loadConnections() {
    try {
      const r = await fetch(`${BASE}/remote-connections`);
      setConnections(await r.json());
    } catch {
      setConnections([]);
    }
  }

  function setField(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  function handleTypeChange(type) {
    setForm(f => ({ ...f, type, port: DEFAULT_PORTS[type] }));
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
    });
    setStatus(conn.hasPassword ? '' : 'No password saved — enter one to connect.');
  }

  function clearForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setStatus('');
  }

  async function handleSave() {
    if (!form.name.trim() || !form.host.trim()) return setStatus('Name and host are required to save.');
    setSaving(true);
    setStatus('');
    try {
      const r = await fetch(`${BASE}/remote-connections`, {
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
    if (!form.host.trim()) return setStatus('Host is required.');
    setConnecting(true);
    setStatus('Connecting…');
    try {
      const r = await fetch(`${BASE}/remote-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId || undefined,
          host: form.host, type: form.type, port: form.port,
          username: form.username, password: form.password,
          domain: form.domain, width: form.width, height: form.height,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const { token } = await r.json();
      await openSession(token, form.name || form.host, form.type);
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
      const r = await fetch(`${BASE}/remote-connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conn.id }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const { token } = await r.json();
      await openSession(token, conn.name, conn.type);
    } catch (err) {
      setStatus(`Failed: ${err.message}`);
      setConnecting(false);
    }
  }

  async function openSession(token, name, type) {
    setView('session');
    setSessionName(name);
    await new Promise(r => setTimeout(r, 80));

    const tunnel = new Guacamole.WebSocketTunnel(`ws://localhost:7000/?token=${encodeURIComponent(token)}`);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    const displayEl = client.getDisplay().getElement();
    displayEl.style.cursor = 'default';
    if (displayRef.current) {
      displayRef.current.innerHTML = '';
      displayRef.current.appendChild(displayEl);
    }

    // Scale display to fit container
    client.getDisplay().onresize = (w, h) => {
      if (!displayRef.current || !w || !h) return;
      const scale = Math.min(
        displayRef.current.clientWidth / w,
        displayRef.current.clientHeight / h,
        1
      );
      client.getDisplay().scale(scale);
    };

    // Keyboard capture
    const keyboard = new Guacamole.Keyboard(document);
    keyboard.onkeydown = k => client.sendKeyEvent(1, k);
    keyboard.onkeyup = k => client.sendKeyEvent(0, k);
    keyboardRef.current = keyboard;

    // Mouse
    const mouse = new Guacamole.Mouse(displayEl);
    mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = mouse.onmouseout =
      e => client.sendMouseState(e.state ?? e);

    client.onerror = err => setStatus(`Connection error: ${err?.message || err}`);
    tunnel.onstatechange = state => {
      // Guacamole.Tunnel.State.CLOSED = 2
      if (state === 2) setStatus('Connection closed.');
    };

    client.connect();
    setConnecting(false);
    setStatus('');

    if (displayRef.current) displayRef.current.focus();
  }

  function disconnectClient() {
    if (keyboardRef.current) { try { keyboardRef.current.reset(); } catch { } keyboardRef.current = null; }
    if (clientRef.current) { try { clientRef.current.disconnect(); } catch { } clientRef.current = null; }
  }

  function handleDisconnect() {
    disconnectClient();
    setView('manager');
    setSessionName('');
    setStatus('');
    setConnecting(false);
  }

  async function handleDelete(e, id) {
    e.stopPropagation();
    try {
      await fetch(`${BASE}/remote-connections/${id}`, { method: 'DELETE' });
      await loadConnections();
      if (editingId === id) clearForm();
    } catch { }
  }

  // ── Session view ─────────────────────────────────────────────────────────────

  if (view === 'session') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 14px', background: 'var(--panel-bg)', borderBottom: '1px solid var(--border)',
          flexShrink: 0, gap: '12px',
        }}>
          <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
            {sessionName || 'Remote Session'}
          </span>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {status && (
              <span style={{ fontSize: '12px', color: status.includes('error') || status.includes('closed') ? '#dc2626' : 'var(--muted)' }}>
                {status}
              </span>
            )}
            <button
              onClick={handleDisconnect}
              className="btn-secondary"
              style={{ fontSize: '12px', padding: '3px 12px', color: '#dc2626', borderColor: '#fca5a5' }}
            >
              Disconnect
            </button>
          </div>
        </div>
        <div
          ref={displayRef}
          tabIndex={0}
          style={{ flex: 1, overflow: 'hidden', background: '#000', outline: 'none', cursor: 'crosshair' }}
        />
      </div>
    );
  }

  // ── Manager view ─────────────────────────────────────────────────────────────

  const grouped = connections.reduce((acc, c) => { (acc[c.type] ||= []).push(c); return acc; }, {});
  const hasConnections = connections.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', padding: '16px', gap: '14px' }}>

      {/* ── Connection form ── */}
      <div className="card" style={{ padding: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h3 style={{ margin: 0 }}>{editingId ? 'Edit Connection' : 'New Connection'}</h3>
          {editingId && (
            <button onClick={clearForm} className="btn-secondary" style={{ fontSize: '11px', padding: '2px 8px' }}>
              + New
            </button>
          )}
        </div>

        {/* Type selector */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
          {CONN_TYPES.map(t => (
            <button
              key={t}
              onClick={() => handleTypeChange(t)}
              style={{
                padding: '4px 14px', fontSize: '12px', fontWeight: 600,
                border: `1px solid ${form.type === t ? 'var(--accent)' : 'var(--border)'}`,
                background: form.type === t ? 'var(--accent-light)' : 'var(--bg)',
                color: form.type === t ? 'var(--accent)' : 'var(--muted)',
                borderRadius: '5px', cursor: 'pointer',
              }}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Host + Port */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '8px', marginBottom: '8px' }}>
          <input
            className="app-input"
            placeholder="Host / IP address"
            value={form.host}
            onChange={e => setField('host', e.target.value)}
          />
          <input
            className="app-input"
            placeholder="Port"
            value={form.port}
            onChange={e => setField('port', e.target.value)}
          />
        </div>

        {/* Username + Password */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <input
            className="app-input"
            placeholder={form.type === 'vnc' ? 'Username (optional)' : 'Username'}
            value={form.username}
            onChange={e => setField('username', e.target.value)}
          />
          <input
            className="app-input"
            type="password"
            placeholder={editingId ? 'Password (leave blank to keep saved)' : 'Password'}
            value={form.password}
            onChange={e => setField('password', e.target.value)}
          />
        </div>

        {/* Domain (RDP only) */}
        {form.type === 'rdp' && (
          <input
            className="app-input"
            placeholder="Domain (optional)"
            value={form.domain}
            onChange={e => setField('domain', e.target.value)}
            style={{ marginBottom: '8px', width: '100%' }}
          />
        )}

        {/* Resolution (RDP / VNC only) */}
        {form.type !== 'ssh' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
            <input
              className="app-input"
              placeholder="Width (px)"
              value={form.width}
              onChange={e => setField('width', e.target.value)}
            />
            <input
              className="app-input"
              placeholder="Height (px)"
              value={form.height}
              onChange={e => setField('height', e.target.value)}
            />
          </div>
        )}

        {/* Connection name */}
        <input
          className="app-input"
          placeholder="Connection name (required to save)"
          value={form.name}
          onChange={e => setField('name', e.target.value)}
          style={{ marginBottom: '10px', width: '100%' }}
        />

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="counter"
            onClick={handleConnect}
            disabled={!form.host.trim() || connecting}
            style={{ padding: '6px 18px', fontSize: '13px' }}
          >
            {connecting ? 'Connecting…' : '▶ Connect'}
          </button>
          <button
            className="btn-secondary"
            onClick={handleSave}
            disabled={!form.name.trim() || !form.host.trim() || saving}
            style={{ fontSize: '13px' }}
          >
            {saving ? 'Saving…' : editingId ? 'Update' : 'Save'}
          </button>
          {status && (
            <span style={{ fontSize: '12px', color: status.includes('failed') || status.includes('Failed') || status.includes('required') ? '#dc2626' : '#059669' }}>
              {status}
            </span>
          )}
        </div>
      </div>

      {/* ── Saved connections ── */}
      <div className="card" style={{ padding: '14px' }}>
        <h3 style={{ margin: '0 0 12px' }}>Saved Connections</h3>

        {!hasConnections && (
          <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>
            No saved connections. Fill in the form above and click Save.
          </p>
        )}

        {CONN_TYPES.filter(t => grouped[t]?.length).map(type => (
          <div key={type} style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '6px' }}>
              {type}
            </div>
            {grouped[type].map(conn => {
              const isSelected = editingId === conn.id;
              return (
                <div
                  key={conn.id}
                  onClick={() => selectConnection(conn)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '7px 10px', borderRadius: '6px', marginBottom: '4px',
                    border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                    background: isSelected ? 'var(--accent-light)' : 'var(--bg)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: '13px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {conn.name}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--muted)', fontFamily: 'ui-monospace, Consolas, monospace', flexShrink: 0 }}>
                    {conn.host}:{conn.port}
                  </span>
                  {conn.username && (
                    <span style={{ fontSize: '11px', color: 'var(--muted)', flexShrink: 0 }}>
                      {conn.username}
                    </span>
                  )}
                  {conn.hasPassword && (
                    <span title="Password saved" style={{ fontSize: '10px', color: '#059669', flexShrink: 0 }}>●</span>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); handleConnectSaved(conn); }}
                    disabled={connecting}
                    style={{
                      padding: '2px 10px', fontSize: '11px', fontWeight: 600,
                      background: 'var(--accent)', color: '#fff', border: 'none',
                      borderRadius: '4px', cursor: connecting ? 'not-allowed' : 'pointer',
                      flexShrink: 0, opacity: connecting ? 0.5 : 1,
                    }}
                  >
                    Connect
                  </button>
                  <button
                    onClick={e => handleDelete(e, conn.id)}
                    style={{
                      padding: '2px 7px', fontSize: '11px',
                      background: 'transparent', color: '#9ca3af',
                      border: '1px solid var(--border)', borderRadius: '4px',
                      cursor: 'pointer', flexShrink: 0,
                    }}
                    title="Delete connection"
                  >
                    ✕
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
