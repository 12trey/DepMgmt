import { useState, useEffect } from 'react';

const BASE       = 'http://localhost:7000';
const MAIN_BASE  = 'http://localhost:4000';
const DEFAULT_REPO = '/home/ansibleapp/repo';

function api(path, opts = {}) {
  return fetch(`${BASE}${path}`, opts);
}

function mainApi(path, opts = {}) {
  return fetch(`${MAIN_BASE}${path}`, opts);
}

// ── WSL filesystem file browser modal (for .json file selection) ──────────────

function FileBrowser({ current, onSelect, onClose }) {
  const [browsePath, setBrowsePath] = useState('/');
  const [entries, setEntries] = useState({ path: '/', parent: null, dirs: [], files: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const start = current && current !== '/'
      ? (current.split('/').slice(0, -1).join('/') || '/')
      : '/';
    navigate(start);
  }, []);

  async function navigate(p) {
    setLoading(true);
    setError('');
    try {
      const res = await api(`/browse?path=${encodeURIComponent(p)}&files=1`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEntries({
        ...data,
        files: (data.files || []).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')),
      });
      setBrowsePath(data.path);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '20px', width: '480px', maxHeight: '70vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#111827' }}>Select Custom Snippets YAML</h3>
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '6px 10px', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '12px', color: '#374151', marginBottom: '8px', wordBreak: 'break-all' }}>
          {browsePath}
        </div>
        {error && <div style={{ color: '#dc2626', fontSize: '12px', marginBottom: '8px' }}>{error}</div>}
        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px', minHeight: '200px' }}>
          {loading && <div style={{ padding: '12px', color: '#9ca3af', fontSize: '13px' }}>Loading…</div>}
          {!loading && entries.parent !== null && (
            <div onClick={() => navigate(entries.parent)} style={dirRowStyle(false)}>
              <span style={{ marginRight: '6px' }}>📁</span>..
            </div>
          )}
          {!loading && entries.dirs.map(d => {
            const fp = entries.path === '/' ? `/${d}` : `${entries.path}/${d}`;
            return (
              <div key={d} onClick={() => navigate(fp)} style={dirRowStyle(false)}>
                <span style={{ marginRight: '6px' }}>📁</span>{d}
              </div>
            );
          })}
          {!loading && entries.files.map(f => {
            const fp = entries.path === '/' ? `/${f}` : `${entries.path}/${f}`;
            return (
              <div key={f} onClick={() => onSelect(fp)} style={{ ...dirRowStyle(fp === current), color: fp === current ? '#2563eb' : '#059669' }}>
                <span style={{ marginRight: '6px' }}>📄</span>{f}
              </div>
            );
          })}
          {!loading && entries.dirs.length === 0 && entries.files.length === 0 && (
            <div style={{ padding: '12px', color: '#9ca3af', fontSize: '13px' }}>No subdirectories or .yaml/.yml files here</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnStyle('secondary')}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── WSL directory browser modal ────────────────────────────────────────────────

function FolderBrowser({ current, onSelect, onClose }) {
  const [browsePath, setBrowsePath] = useState('/');
  const [entries, setEntries] = useState({ path: '/', parent: null, dirs: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const start = current && current !== '/'
      ? (current.split('/').slice(0, -1).join('/') || '/')
      : '/';
    navigate(start);
  }, []);

  async function navigate(p) {
    setLoading(true);
    setError('');
    try {
      const res = await api(`/browse?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setEntries(data);
      setBrowsePath(data.path);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px',
        padding: '20px', width: '480px', maxHeight: '70vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#111827' }}>Browse WSL Filesystem</h3>

        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px',
          padding: '6px 10px', fontFamily: 'ui-monospace, Consolas, monospace',
          fontSize: '12px', color: '#374151', marginBottom: '8px', wordBreak: 'break-all',
        }}>
          {browsePath}
        </div>

        {error && (
          <div style={{ color: '#dc2626', fontSize: '12px', marginBottom: '8px' }}>{error}</div>
        )}

        <div style={{
          flex: 1, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px',
          minHeight: '200px',
        }}>
          {loading && (
            <div style={{ padding: '12px', color: '#9ca3af', fontSize: '13px' }}>Loading…</div>
          )}
          {!loading && entries.parent !== null && (
            <div onClick={() => navigate(entries.parent)} style={dirRowStyle(false)}>
              <span style={{ marginRight: '6px' }}>📁</span>..
            </div>
          )}
          {!loading && entries.dirs.map(d => {
            const fullPath = entries.path === '/' ? `/${d}` : `${entries.path}/${d}`;
            return (
              <div key={d} onClick={() => navigate(fullPath)} style={dirRowStyle(fullPath === current)}>
                <span style={{ marginRight: '6px' }}>📁</span>{d}
              </div>
            );
          })}
          {!loading && entries.dirs.length === 0 && entries.parent !== null && (
            <div style={{ padding: '12px', color: '#9ca3af', fontSize: '13px' }}>No subdirectories</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnStyle('secondary')}>Cancel</button>
          <button onClick={() => onSelect(browsePath)} style={btnStyle('primary')}>
            Select "{browsePath}"
          </button>
        </div>
      </div>
    </div>
  );
}

function dirRowStyle(selected) {
  return {
    padding: '7px 12px', cursor: 'pointer', fontSize: '13px',
    fontFamily: 'ui-monospace, Consolas, monospace',
    background: selected ? '#eff6ff' : 'transparent',
    color: selected ? '#2563eb' : '#374151',
    borderBottom: '1px solid #f3f4f6', userSelect: 'none',
  };
}

// ── KDC server list sub-component ──────────────────────────────────────────────

function KdcList({ servers, onChange }) {
  const [draft, setDraft] = useState('');

  function add() {
    const v = draft.trim();
    if (!v || servers.includes(v)) return;
    onChange([...servers, v]);
    setDraft('');
  }

  function remove(i) {
    onChange(servers.filter((_, idx) => idx !== i));
  }

  function handleKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  }

  return (
    <div>
      {servers.map((s, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          marginBottom: '4px',
        }}>
          <span style={{
            flex: 1, padding: '5px 10px', background: '#f9fafb',
            border: '1px solid #e5e7eb', borderRadius: '6px',
            fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '13px', color: '#374151',
          }}>{s}</span>
          <button
            onClick={() => remove(i)}
            title="Remove"
            style={{ ...btnStyle('secondary'), padding: '4px 8px', color: '#dc2626' }}
          >✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '6px', marginTop: servers.length ? '6px' : '0' }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder="kdc.example.com"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={add} style={btnStyle('secondary')}>Add</button>
      </div>
    </div>
  );
}

// ── Main Config component ──────────────────────────────────────────────────────

function Config() {
  // Repo folder state
  const [repoFolder, setRepoFolder] = useState('');
  const [savedFolder, setSavedFolder] = useState('');
  const [showBrowser, setShowBrowser] = useState(false);
  const [folderStatus, setFolderStatus] = useState('');

  // Custom snippets state
  const [snippetsPath, setSnippetsPath] = useState('');
  const [savedSnippetsPath, setSavedSnippetsPath] = useState('');
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [snippetsStatus, setSnippetsStatus] = useState('');

  // Kerberos form state
  const [realm, setRealm] = useState('');
  const [kdcServers, setKdcServers] = useState([]);
  const [adminServer, setAdminServer] = useState('');
  const [defaultDomain, setDefaultDomain] = useState('');
  const [krb5Status, setKrb5Status] = useState('');
  const [wslInstance, setWslInstance] = useState('');

  useEffect(() => {
    api('/config/app')
      .then(r => r.json())
      .then(d => { setRepoFolder(d.repoFolder || DEFAULT_REPO); setSavedFolder(d.repoFolder || DEFAULT_REPO); })
      .catch(() => { setRepoFolder(DEFAULT_REPO); setSavedFolder(DEFAULT_REPO); });

    api('/config/custom-snippets')
      .then(r => r.json())
      .then(d => { setSnippetsPath(d.path || ''); setSavedSnippetsPath(d.path || ''); })
      .catch(() => {});

    api('/config/instance')
      .then(r => r.json())
      .then(d => setWslInstance(d.instance || ''))
      .catch(() => {});

    api('/config/krb5')
      .then(r => r.json())
      .then(d => {
        setRealm(d.realm || '');
        setKdcServers(d.kdcServers || []);
        setAdminServer(d.adminServer || '');
        setDefaultDomain(d.defaultDomain || '');
      })
      .catch(() => {});
  }, []);

  async function saveFolder() {
    setFolderStatus('');
    try {
      const res = await api('/config/app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoFolder }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedFolder(repoFolder);
      setFolderStatus('Saved.');
    } catch (e) {
      setFolderStatus(`Error: ${e.message}`);
    }
  }

  async function saveSnippetsPath() {
    setSnippetsStatus('');
    try {
      const res = await api('/config/custom-snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: snippetsPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSavedSnippetsPath(snippetsPath);
      setSnippetsStatus('Saved.');
    } catch (e) {
      setSnippetsStatus(`Error: ${e.message}`);
    }
  }

  async function saveKrb5() {
    setKrb5Status('');
    if (!wslInstance) {
      setKrb5Status('Error: WSL instance name not detected.');
      return;
    }
    try {
      const res = await mainApi('/api/wsl/krb5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instance: wslInstance, realm, kdcServers, adminServer, defaultDomain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setKrb5Status('Saved.');
    } catch (e) {
      setKrb5Status(`Error: ${e.message}`);
    }
  }

  const folderChanged = repoFolder !== savedFolder;

  return (
    <div style={{ padding: '20px', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: '18px', color: '#111827' }}>Configuration</h2>

      {/* ── Repository Folder ─────────────────────────────── */}
      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Repository Folder</h3>
        <p style={descStyle}>
          Path to the Ansible repository on the WSL filesystem. Used by all file operations and git commands.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            value={repoFolder}
            onChange={e => setRepoFolder(e.target.value)}
            style={inputStyle}
            spellCheck={false}
          />
          <button onClick={() => setShowBrowser(true)} style={btnStyle('secondary')}>Browse…</button>
          <button
            onClick={() => setRepoFolder(DEFAULT_REPO)}
            title={`Reset to ${DEFAULT_REPO}`}
            style={btnStyle('secondary')}
          >Reset</button>
        </div>
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={saveFolder} disabled={!folderChanged} style={btnStyle('primary', !folderChanged)}>
            Save
          </button>
          <StatusText msg={folderStatus} />
        </div>
      </section>

      {/* ── Custom Snippets ───────────────────────────────── */}
      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Ansible Custom Snippets</h3>
        <p style={descStyle}>
          Path to a YAML file containing a list of custom snippet objects. Each item must have <code>name</code> and <code>snippet</code> string fields, and optionally <code>desc</code>.
          Use the <code>|</code> block scalar for multi-line snippets. The file can live on the Windows filesystem (accessible via <code>/mnt/c/...</code>) or anywhere in WSL.
        </p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            value={snippetsPath}
            onChange={e => setSnippetsPath(e.target.value)}
            placeholder="e.g. /mnt/c/Users/you/snippets.yaml"
            style={inputStyle}
            spellCheck={false}
          />
          <button onClick={() => setShowFileBrowser(true)} style={btnStyle('secondary')}>Browse…</button>
          {snippetsPath && (
            <button onClick={() => setSnippetsPath('')} style={btnStyle('secondary')}>Clear</button>
          )}
        </div>
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={saveSnippetsPath}
            disabled={snippetsPath === savedSnippetsPath}
            style={btnStyle('primary', snippetsPath === savedSnippetsPath)}
          >
            Save
          </button>
          <StatusText msg={snippetsStatus} />
        </div>
      </section>

      {/* ── Kerberos Configuration ────────────────────────── */}
      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>Kerberos Configuration</h3>
        <p style={descStyle}>
          Updates <code>/etc/krb5.conf</code> on the WSL instance.
        </p>

        <div style={fieldGrid}>
          <label style={labelStyle}>Realm</label>
          <input
            value={realm}
            onChange={e => setRealm(e.target.value.toUpperCase())}
            placeholder="CONTOSO.COM"
            style={inputStyle}
          />

          <label style={labelStyle}>KDC Servers</label>
          <KdcList servers={kdcServers} onChange={setKdcServers} />

          <label style={labelStyle}>Admin Server</label>
          <input
            value={adminServer}
            onChange={e => setAdminServer(e.target.value)}
            placeholder={kdcServers[0] || 'kdc.contoso.com'}
            style={inputStyle}
          />

          <label style={labelStyle}>Default Domain</label>
          <input
            value={defaultDomain}
            onChange={e => setDefaultDomain(e.target.value)}
            placeholder={realm ? realm.toLowerCase() : 'contoso.com'}
            style={inputStyle}
          />
        </div>

        <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={saveKrb5} disabled={!realm} style={btnStyle('primary', !realm)}>
            Save
          </button>
          <StatusText msg={krb5Status} />
        </div>
      </section>

      {showBrowser && (
        <FolderBrowser
          current={repoFolder}
          onSelect={p => { setRepoFolder(p); setShowBrowser(false); }}
          onClose={() => setShowBrowser(false)}
        />
      )}

      {showFileBrowser && (
        <FileBrowser
          current={snippetsPath}
          onSelect={p => { setSnippetsPath(p); setShowFileBrowser(false); }}
          onClose={() => setShowFileBrowser(false)}
        />
      )}
    </div>
  );
}

function StatusText({ msg }) {
  if (!msg) return null;
  const isErr = msg.startsWith('Error');
  return (
    <span style={{ fontSize: '12px', color: isErr ? '#dc2626' : '#16a34a' }}>{msg}</span>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const sectionStyle = {
  background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px',
  padding: '16px 20px', marginBottom: '16px',
};

const sectionTitleStyle = { margin: '0 0 6px', fontSize: '15px', fontWeight: 600, color: '#111827' };

const descStyle = { margin: '0 0 12px', fontSize: '13px', color: '#6b7280' };

const fieldGrid = {
  display: 'grid',
  gridTemplateColumns: '130px 1fr',
  gap: '10px',
  alignItems: 'start',
};

const labelStyle = {
  fontSize: '13px', fontWeight: 500, color: '#374151',
  paddingTop: '7px',
};

const inputStyle = {
  padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: '6px',
  fontFamily: 'ui-monospace, Consolas, monospace', fontSize: '13px', color: '#111827',
  outline: 'none', width: '100%', boxSizing: 'border-box',
};

function btnStyle(variant, disabled = false) {
  const base = {
    padding: '6px 14px', border: 'none', borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 500,
    opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
  };
  if (variant === 'primary') return { ...base, background: '#2563eb', color: '#fff' };
  return { ...base, background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' };
}

export default Config;
