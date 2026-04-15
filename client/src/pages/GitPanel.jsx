import { useEffect, useState } from 'react';
import { gitClone, gitPull, gitPush, gitStatus } from '../api';

export default function GitPanel() {
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState('');

  const loadStatus = () => gitStatus().then(setStatus).catch(() => {});
  useEffect(() => { loadStatus(); }, []);

  const action = async (name, fn) => {
    setLoading(name);
    setMsg('');
    try {
      const result = await fn();
      setMsg(result.message || JSON.stringify(result));
      loadStatus();
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setLoading('');
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Git Integration</h1>
      {msg && <div className="bg-blue-50 text-blue-700 p-3 rounded mb-4">{msg}</div>}

      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <h2 className="font-semibold mb-3">Repository Status</h2>
        {status ? (
          status.initialized ? (
            <div className="text-sm space-y-1">
              <p>Branch: <strong>{status.current}</strong></p>
              <p>Modified: {status.modified?.length || 0} | Staged: {status.staged?.length || 0} | Untracked: {status.not_added?.length || 0}</p>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No repository initialized. Clone one below.</p>
          )
        ) : (
          <p className="text-sm text-gray-400">Loading...</p>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Repository URL</label>
          <div className="flex gap-2">
            <input className="input flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/..." />
            <button onClick={() => action('clone', () => gitClone(url))} disabled={!!loading || !url} className="btn-primary">
              {loading === 'clone' ? 'Cloning...' : 'Clone'}
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => action('pull', gitPull)} disabled={!!loading} className="btn-secondary">
            {loading === 'pull' ? 'Pulling...' : 'Pull Latest'}
          </button>
          <button onClick={() => action('push', gitPush)} disabled={!!loading} className="btn-secondary">
            {loading === 'push' ? 'Pushing...' : 'Push Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
