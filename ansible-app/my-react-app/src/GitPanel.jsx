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
        background: '#111', color: '#eee', borderRadius: '6px', padding: '8px',
        height: '200px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '12px',
      }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.type === 'exit' && !l.ok ? '#f88' : l.type === 'exit' ? '#8f8' : '#eee' }}>
            {l.line || (l.type === 'exit' ? (l.ok ? '✓ Clone complete' : `✗ ${l.error}`) : JSON.stringify(l))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {lines.some(l => l.type === 'exit') && (
        <button onClick={onClose} style={btnStyle('secondary', true)}>Close</button>
      )}
    </div>
  );
}

// ── Push confirmation modal ────────────────────────────────────────────────────

function PushConfirmModal({ branch, onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#1e1e2e', border: '1px solid #444', borderRadius: '10px',
        padding: '24px', width: '360px', color: '#eee',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '16px' }}>Confirm Push</h3>
        <p style={{ fontSize: '13px', color: '#aaa', margin: '0 0 20px' }}>
          Push committed changes to remote on branch <strong style={{ color: '#7dd3fc' }}>{branch}</strong>?
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

  const [cloneLog, setCloneLog] = useState(null); // null = hidden
  const [cloning, setCloning] = useState(false);

  const [status, setStatus] = useState(null); // { files, branch }
  const [statusError, setStatusError] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [staging, setStaging] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState('');

  const [showPushConfirm, setShowPushConfirm] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState('');

  // Load config on mount
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
  const hasStagedChanges = status?.files?.some(f => f.status && f.status[0] !== '?' && f.status[0] !== ' ');

  return (
    <div style={{ padding: '16px', color: '#eee', maxWidth: '700px' }}>
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
          <button
            onClick={saveUrl}
            disabled={urlSaving}
            style={btnStyle('primary', urlSaving)}
          >
            {urlSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
          Credentials are used for clone and push. Leave blank for public repos or SSH remotes.
        </div>
        {savedUrl && (
          <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
            Saved: <span style={{ color: '#7dd3fc' }}>{savedUrl}</span>
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', alignItems: 'center' }}>
          <button
            onClick={startClone}
            disabled={cloning || !savedUrl}
            style={btnStyle('primary', cloning || !savedUrl)}
          >
            {cloning ? 'Cloning…' : 'Clone / Re-clone to /home/ansibleapp/repo'}
          </button>
        </div>
        {cloneLog !== null && (
          <CloneLog lines={cloneLog} onClose={() => setCloneLog(null)} />
        )}
      </section>

      {/* ── Git status ── */}
      <section style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
          <h3 style={{ ...headingStyle, margin: 0 }}>Working Tree</h3>
          <button
            onClick={loadStatus}
            disabled={loadingStatus}
            style={btnStyle('secondary', loadingStatus)}
          >
            {loadingStatus ? 'Refreshing…' : 'Refresh Status'}
          </button>
        </div>

        {statusError && (
          <div style={{ color: '#f88', fontSize: '12px', marginBottom: '8px' }}>{statusError}</div>
        )}

        {status && (
          <>
            <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px' }}>
              Branch: <strong style={{ color: '#a5f3fc' }}>{status.branch}</strong>
            </div>
            {status.files.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#888' }}>Nothing to commit — working tree clean.</div>
            ) : (
              <div style={{ marginBottom: '10px' }}>
                {status.files.map((f, i) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: '12px', color: statusColor(f.status) }}>
                    {f.status.padEnd(2)} {f.file}
                  </div>
                ))}
              </div>
            )}

            {hasChanges && (
              <button
                onClick={stageAll}
                disabled={staging}
                style={btnStyle('secondary', staging)}
              >
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
          <input
            type="text"
            value={commitMsg}
            onChange={e => { setCommitMsg(e.target.value); setCommitError(''); }}
            placeholder="Commit message…"
            style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter') doCommit(); }}
          />
          {commitError && (
            <div style={{ color: '#f88', fontSize: '12px', marginTop: '4px' }}>{commitError}</div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              onClick={doCommit}
              disabled={committing || !commitMsg.trim()}
              style={btnStyle('primary', committing || !commitMsg.trim())}
            >
              {committing ? 'Committing…' : 'Commit'}
            </button>
            <button
              onClick={() => setShowPushConfirm(true)}
              disabled={pushing}
              style={btnStyle('danger', pushing)}
            >
              {pushing ? 'Pushing…' : 'Push to Remote'}
            </button>
          </div>
          {pushResult && (
            <pre style={{
              marginTop: '10px', fontSize: '12px', color: pushResult.startsWith('Push failed') ? '#f88' : '#8f8',
              background: '#111', padding: '8px', borderRadius: '6px', whiteSpace: 'pre-wrap',
            }}>
              {pushResult}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(s) {
  if (!s) return '#eee';
  const c = s[0] || ' ';
  if (c === 'M') return '#fcd34d';
  if (c === 'A') return '#86efac';
  if (c === 'D') return '#fca5a5';
  if (c === '?') return '#94a3b8';
  return '#eee';
}

const sectionStyle = {
  background: '#1a1a2e', border: '1px solid #333', borderRadius: '8px',
  padding: '14px', marginBottom: '14px',
};

const headingStyle = {
  margin: '0 0 10px', fontSize: '14px', fontWeight: '600', color: '#e2e8f0',
};

const inputStyle = {
  flex: 1, background: '#0f0f1a', border: '1px solid #444', borderRadius: '6px',
  padding: '6px 10px', color: '#eee', fontSize: '13px', outline: 'none', width: '100%',
};

function btnStyle(variant, disabled = false) {
  const base = {
    border: 'none', borderRadius: '6px', padding: '6px 14px',
    fontSize: '13px', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
  };
  if (variant === 'primary') return { ...base, background: '#3b82f6', color: '#fff' };
  if (variant === 'danger') return { ...base, background: '#ef4444', color: '#fff' };
  return { ...base, background: '#374151', color: '#d1d5db' };
}
