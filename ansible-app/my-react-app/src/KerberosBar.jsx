import { useState, useEffect, useCallback } from 'react';

const BASE = 'http://localhost:7000';
const REFRESH_INTERVAL = 5 * 60 * 1000; // re-check every 5 minutes

export default function KerberosBar() {
  const [status, setStatus]       = useState(null);  // null = loading
  const [checking, setChecking]   = useState(false);

  const [username, setUsername]   = useState(() => localStorage.getItem('krb-username') || '');
  const [password, setPassword]   = useState('');
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState('');
  const [showForm, setShowForm]   = useState(false);

  const [destroying, setDestroying] = useState(false);

  const checkStatus = useCallback(async (quiet = false) => {
    console.log("CHECK KERBEROS STATUS");
    if (!quiet) setChecking(true);
    try {
      const r = await fetch(`${BASE}/kerberos/status`);
      const d = await r.json();
      setStatus(d);
      if (d.valid) setShowForm(false);
    } catch {
      setStatus({ valid: false, principal: '', expires: '' });
    } finally {
      if (!quiet) setChecking(false);
    }
  }, []);

  // Initial check + periodic refresh
  useEffect(() => {
    checkStatus();
    const id = setInterval(() => checkStatus(true), REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [checkStatus]);

  async function authenticate(e) {
    e.preventDefault();
    if (!username || !password) { setAuthError('Enter username and password.'); return; }
    setAuthenticating(true);
    setAuthError('');
    try {
      const r = await fetch(`${BASE}/kerberos/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json();
      if (!r.ok) { setAuthError(d.error || 'Authentication failed'); return; }
      localStorage.setItem('krb-username', username);
      setPassword('');
      await checkStatus();
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthenticating(false);
    }
  }

  async function destroy() {
    setDestroying(true);
    try {
      await fetch(`${BASE}/kerberos/destroy`, { method: 'POST' });
      await checkStatus();
    } catch {}
    finally { setDestroying(false); }
  }

  // ── render ───────────────────────────────────────────────────────────────────

  if (status === null) {
    return (
      <div style={barStyle('var(--bg)', 'var(--border)')}>
        <span style={{ color: 'var(--muted)', fontSize: '12px' }}>Checking Kerberos…</span>
      </div>
    );
  }

  if (status.valid) {
    return (
      <div style={barStyle('var(--status-ok-bg)', 'var(--status-ok-border)')}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-ok-dot)', display: 'inline-block', flexShrink: 0 }} />
        <span style={{ color: 'var(--status-ok-text)', fontSize: '12px', fontWeight: 500 }}>
          {status.principal}
        </span>
        {status.expires && (
          <span style={{ color: 'var(--muted)', fontSize: '11px' }}>
            expires {status.expires}
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button
            onClick={() => checkStatus()}
            disabled={checking}
            style={smallBtn()}
            title="Refresh ticket status"
          >
            {checking ? '…' : '↻ Refresh'}
          </button>
          <button
            onClick={destroy}
            disabled={destroying}
            style={smallBtn('#fee2e2', '#dc2626', '#b91c1c')}
            title="Destroy Kerberos ticket (kdestroy)"
          >
            {destroying ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      </div>
    );
  }

  // No valid ticket — show status + inline credential form
  return (
    <div style={{ borderBottom: '1px solid var(--status-err-border)', background: 'var(--status-err-outer)' }}>
      {/* Status row */}
      <div style={{ ...barStyle('var(--status-err-bg)', 'var(--status-err-border)'), borderBottom: showForm ? '1px solid var(--status-err-border)' : 'none' }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-err-dot)', display: 'inline-block', flexShrink: 0 }} />
        <span style={{ color: 'var(--status-err-text)', fontSize: '12px' }}>No valid Kerberos ticket</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button
            onClick={() => { setShowForm(v => !v); setAuthError(''); }}
            style={smallBtn()}
          >
            {showForm ? 'Cancel' : 'Authenticate…'}
          </button>
        </div>
      </div>

      {/* Credential form */}
      {showForm && (
        <form onSubmit={authenticate} style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 12px', background: 'var(--panel-bg)', flexWrap: 'wrap',
          borderTop: '1px solid var(--border)',
        }}>
          <input
            type="text"
            placeholder="username or user@REALM"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => { setPassword(e.target.value); setAuthError(''); }}
            autoComplete="current-password"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={authenticating}
            style={{
              background: authenticating ? '#93c5fd' : 'var(--accent)',
              color: '#fff', border: 'none', borderRadius: '5px',
              padding: '5px 14px', fontSize: '12px', fontWeight: 500,
              cursor: authenticating ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {authenticating ? 'Running kinit…' : 'Authenticate (kinit)'}
          </button>
          {authError && (
            <span style={{ color: '#dc2626', fontSize: '12px', width: '100%' }}>
              {authError}
            </span>
          )}
        </form>
      )}
    </div>
  );
}

// ── style helpers ──────────────────────────────────────────────────────────────

function barStyle(bg, border) {
  return {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '5px 12px',
    background: bg,
    borderBottom: `1px solid ${border}`,
    minHeight: '30px',
  };
}

function smallBtn(bg = 'var(--bg-hover)', color = 'var(--text)', hoverBg = 'var(--bg-hover)') {
  return {
    background: bg, color, border: '1px solid var(--border-dark)',
    borderRadius: '4px', padding: '3px 10px',
    fontSize: '11px', cursor: 'pointer', fontWeight: 500,
  };
}

const inputStyle = {
  background: 'var(--panel-bg)', border: '1px solid var(--border-dark)', borderRadius: '5px',
  padding: '4px 8px', color: 'var(--text-h)', fontSize: '12px', outline: 'none',
  width: '200px',
};
