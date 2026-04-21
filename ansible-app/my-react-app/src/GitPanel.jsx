import { useState, useEffect, useRef } from 'react';

const BASE = 'http://localhost:7000';

function api(path, opts = {}) {
  return fetch(`${BASE}${path}`, opts);
}

// ── Clone output log ───────────────────────────────────────────────────────────

function CloneLog({ lines, onClose }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);

  return (
    <div style={{ marginTop: '10px' }}>
      <div style={{
        background: '#111827', color: '#f3f4f6', borderRadius: '6px', padding: '8px',
        height: '200px', overflowY: 'auto', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px',
        border: '1px solid #374151',
      }}>
        {lines.map((l, i) => (
          <div key={i} style={{
            color: l.type === 'exit' && !l.ok ? '#fca5a5'
                 : l.type === 'exit' ? '#86efac'
                 : '#f3f4f6',
          }}>
            {l.line || (l.type === 'exit' ? (l.ok ? 'Clone complete' : `Error: ${l.error}`) : JSON.stringify(l))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {lines.some(l => l.type === 'exit') && (
        <button onClick={onClose} style={{ ...btnStyle('secondary'), marginTop: '8px' }}>Close</button>
      )}
    </div>
  );
}

// ── Push confirmation modal ────────────────────────────────────────────────────

function PushConfirmModal({ branch, onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px',
        padding: '24px', width: '360px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '16px', color: '#111827' }}>Confirm Push</h3>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: '0 0 20px' }}>
          Push committed changes to remote on branch{' '}
          <strong style={{ color: '#2563eb', fontFamily: 'ui-monospace, Consolas, monospace' }}>{branch}</strong>?
          This action cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnStyle('secondary')}>Cancel</button>
          <button onClick={onConfirm} style={btnStyle('danger')}>Push</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Git panel ─────────────────────────────────────────────────────────────

export default function GitPanel() {
  const [repoUrl, setRepoUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [gitUsername, setGitUsername] = useState('');
  const [gitToken, setGitToken] = useState('');
  const [urlSaving, setUrlSaving] = useState(false);

  const [cloneLog, setCloneLog] = useState(null);
  const [cloning, setCloning] = useState(false);

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [staging, setStaging] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');

  const [showPushConfirm, setShowPushConfirm] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState('');

  useEffect(() => {
    api('/git/config')
      .then(r => r.json())
      .then(d => {
        setRepoUrl(d.repoUrl || '');
        setSavedUrl(d.repoUrl || '');
        setGitUsername(d.gitUsername || '');
        setGitToken(d.gitToken || '');
      })
      .catch(() => {});
  }, []);

  async function saveUrl() {
    setUrlSaving(true);
    try {
      await api('/git/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, gitUsername, gitToken }),
      });
      setSavedUrl(repoUrl);
    } catch (err) {
      alert(`Failed to save: ${err.message}`);
    } finally {
      setUrlSaving(false);
    }
  }

  async function startClone() {
    if (!savedUrl) return;
    setCloning(true);
    setCloneLog([]);

    const r = await fetch(`${BASE}/git/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
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
          try { setCloneLog(prev => [...prev, JSON.parse(line)]); } catch {}
        }
      }
    }
    setCloning(false);
  }

  async function loadStatus() {
    setLoadingStatus(true);
    setStatusError('');
    try {
      const r = await api('/git/status');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setStatus(d);
    } catch (err) {
      setStatusError(err.message);
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }

  async function stageAll() {
    setStaging(true);
    try {
      const r = await api('/git/stage', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await loadStatus();
    } catch (err) {
      setStatusError(`Stage failed: ${err.message}`);
    } finally {
      setStaging(false);
    }
  }

  async function doCommit() {
    if (!commitMsg.trim()) { setCommitError('Please enter a commit message.'); return; }
    setCommitting(true);
    setCommitError('');
    try {
      const r = await api('/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMsg }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setCommitMsg('');
      await loadStatus();
    } catch (err) {
      setCommitError(err.message);
    } finally {
      setCommitting(false);
    }
  }

  async function doPush() {
    setShowPushConfirm(false);
    setPushing(true);
    setPushResult('');
    try {
      const r = await api('/git/push', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setPushResult(`Pushed successfully.\n${d.output || ''}`);
    } catch (err) {
      setPushResult(`Push failed: ${err.message}`);
    } finally {
      setPushing(false);
    }
  }

  const hasChanges = status?.files?.length > 0;

  return (
    <div style={{ padding: '16px', maxWidth: '700px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
      {showPushConfirm && (
        <PushConfirmModal
          branch={status?.branch || 'main'}
          onConfirm={doPush}
          onCancel={() => setShowPushConfirm(false)}
        />
      )}

      {/* ── Repo URL config ── */}
      <section style={sectionStyle}>
        <h3 style={headingStyle}>Repository</h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            value={repoUrl}
            onChange={e => setRepoUrl(e.target.value)}
            placeholder="https://github.com/you/ansible-repo.git"
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <input
            type="text"
            value={gitUsername}
            onChange={e => setGitUsername(e.target.value)}
            placeholder="Username"
            style={{ ...inputStyle, flex: '1 1 40%' }}
            autoComplete="username"
          />
          <input
            type="password"
            value={gitToken}
            onChange={e => setGitToken(e.target.value)}
            placeholder="Password / API token"
            style={{ ...inputStyle, flex: '1 1 60%' }}
            autoComplete="current-password"
          />
          <button onClick={saveUrl} disabled={urlSaving} style={btnStyle('primary', urlSaving)}>
            {urlSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px' }}>
          We advise using a personal access token for better security. Credentials are encrypted and 
          persisted to the WSL disk using the WSL installation's machine-id. Alternatively, you
          can use the terminal to access the repo at <code style={{ color: '#787878' }}>/home/ansibleapp/repo</code> and push/pull from the command line.
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '6px' }}>
          Credentials are used for clone and push. Leave blank for public repos or SSH remotes.
        </div>
        {savedUrl && (
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
            Saved: <span style={{ color: '#2563eb', fontFamily: 'ui-monospace, Consolas, monospace' }}>{savedUrl}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
          <button onClick={startClone} disabled={cloning || !savedUrl} style={btnStyle('secondary', cloning || !savedUrl)}>
            {cloning ? 'Cloning…' : 'Clone / Re-clone to /home/ansibleapp/repo'}
          </button>
        </div>
        {cloneLog !== null && (
          <CloneLog lines={cloneLog} onClose={() => setCloneLog(null)} />
        )}
      </section>

      {/* ── Git status ── */}
      <section style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <h3 style={{ ...headingStyle, margin: 0 }}>Working Tree</h3>
          <button onClick={loadStatus} disabled={loadingStatus} style={btnStyle('secondary', loadingStatus)}>
            {loadingStatus ? 'Refreshing…' : 'Refresh Status'}
          </button>
        </div>

        {statusError && (
          <div style={{ color: '#dc2626', fontSize: '12px', marginBottom: '8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '5px', padding: '6px 10px' }}>
            {statusError}
          </div>
        )}

        {status && (
          <>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
              Branch: <strong style={{ color: '#2563eb', fontFamily: 'ui-monospace, Consolas, monospace' }}>{status.branch}</strong>
            </div>
            {status.files.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#6b7280' }}>Nothing to commit — working tree clean.</div>
            ) : (
              <div style={{ marginBottom: '10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '8px 10px' }}>
                {status.files.map((f, i) => (
                  <div key={i} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', color: statusColor(f.status), padding: '1px 0' }}>
                    <span style={{ marginRight: '8px', opacity: 0.7 }}>{f.status.trim()}</span>{f.file}
                  </div>
                ))}
              </div>
            )}

            {hasChanges && (
              <button onClick={stageAll} disabled={staging} style={btnStyle('secondary', staging)}>
                {staging ? 'Staging…' : 'Stage All Changes'}
              </button>
            )}
          </>
        )}
      </section>

      {/* ── Commit ── */}
      {status && (
        <section style={sectionStyle}>
          <h3 style={headingStyle}>Commit</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={commitMsg}
              onChange={e => { setCommitMsg(e.target.value); setCommitError(''); }}
              placeholder="Commit message…"
              style={inputStyle}
              onKeyDown={e => { if (e.key === 'Enter') doCommit(); }}
            />
          </div>
          {commitError && (
            <div style={{ color: '#dc2626', fontSize: '12px', marginTop: '6px' }}>{commitError}</div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button onClick={doCommit} disabled={committing || !commitMsg.trim()} style={btnStyle('primary', committing || !commitMsg.trim())}>
              {committing ? 'Committing…' : 'Commit'}
            </button>
            <button onClick={() => setShowPushConfirm(true)} disabled={pushing} style={btnStyle('danger', pushing)}>
              {pushing ? 'Pushing…' : 'Push to Remote'}
            </button>
          </div>
          {pushResult && (
            <div style={{
              marginTop: '10px', fontSize: '12px', padding: '8px 10px', borderRadius: '6px',
              fontFamily: 'ui-monospace, Consolas, monospace', whiteSpace: 'pre-wrap',
              background: pushResult.startsWith('Push failed') ? '#fef2f2' : '#f0fdf4',
              color:      pushResult.startsWith('Push failed') ? '#991b1b' : '#15803d',
              border:     `1px solid ${pushResult.startsWith('Push failed') ? '#fecaca' : '#bbf7d0'}`,
            }}>
              {pushResult}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(s) {
  if (!s) return '#374151';
  const c = s.trim()[0] || ' ';
  if (c === 'M') return '#d97706'; // amber
  if (c === 'A') return '#16a34a'; // green
  if (c === 'D') return '#dc2626'; // red
  if (c === '?') return '#6b7280'; // gray
  return '#374151';
}

const sectionStyle = {
  background: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '14px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const headingStyle = {
  margin: '0 0 10px',
  fontSize: '14px',
  fontWeight: '600',
  color: '#111827',
};

const inputStyle = {
  flex: 1,
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  padding: '6px 10px',
  color: '#111827',
  fontSize: '13px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

function btnStyle(variant, disabled = false) {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    border: 'none', borderRadius: '6px', padding: '6px 14px',
    fontSize: '13px', fontWeight: '500',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    whiteSpace: 'nowrap',
    transition: 'background 0.15s',
  };
  if (variant === 'primary')   return { ...base, background: '#2563eb', color: '#fff' };
  if (variant === 'danger')    return { ...base, background: '#dc2626', color: '#fff' };
  return { ...base, background: '#fff', color: '#374151', border: '1px solid #d1d5db' };
}
