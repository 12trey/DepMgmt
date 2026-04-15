import { useEffect, useState } from 'react';
import { gitClone, gitPull, gitPush, gitLog } from '../api';
import { GitBranch, ArrowUp, ArrowDown, RefreshCw, Upload, Download } from 'lucide-react';

export default function GitPanel() {
  const [repoLog, setRepoLog] = useState(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState('');

  const loadLog = () => gitLog().then(setRepoLog).catch(() => {});
  useEffect(() => { loadLog(); }, []);

  const action = async (name, fn) => {
    setLoading(name); setMsg(''); setError('');
    try {
      const result = await fn();
      setMsg(result.message || 'Done.');
      loadLog();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading('');
    }
  };

  const initialized = repoLog?.initialized;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Git Repository</h1>
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded mb-4">{msg}</div>}
      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error}</div>}

      {/* Status bar */}
      <div className="bg-white rounded-lg shadow p-5 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <GitBranch size={16} className="text-gray-400" />
            {initialized ? (
              <>
                <span className="font-medium">{repoLog.current || 'unknown'}</span>
                {repoLog.ahead > 0 && (
                  <span className="flex items-center gap-1 text-blue-600 font-medium">
                    <ArrowUp size={14} /> {repoLog.ahead} unpushed
                  </span>
                )}
                {repoLog.behind > 0 && (
                  <span className="flex items-center gap-1 text-amber-600 font-medium">
                    <ArrowDown size={14} /> {repoLog.behind} behind remote
                  </span>
                )}
                {repoLog.ahead === 0 && repoLog.behind === 0 && (
                  <span className="text-green-600">Up to date</span>
                )}
              </>
            ) : (
              <span className="text-gray-500">No repository — clone one below</span>
            )}
          </div>
          <button onClick={loadLog} className="text-gray-400 hover:text-gray-600" title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="bg-white rounded-lg shadow p-5 mb-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Clone a repository</label>
          <div className="flex gap-2">
            <input className="input flex-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/org/repo.git" />
            <button onClick={() => action('clone', () => gitClone(url))} disabled={!!loading || !url} className="btn-primary">
              {loading === 'clone' ? 'Cloning…' : 'Clone'}
            </button>
          </div>
        </div>

        {initialized && (
          <div className="flex gap-3 pt-1 border-t">
            <button onClick={() => action('pull', gitPull)} disabled={!!loading} className="btn-secondary">
              <Download size={15} /> {loading === 'pull' ? 'Pulling…' : 'Pull'}
            </button>
            <button onClick={() => action('push', gitPush)} disabled={!!loading} className="btn-primary">
              <Upload size={15} /> {loading === 'push' ? 'Pushing…' : `Push${repoLog?.ahead > 0 ? ` (${repoLog.ahead})` : ''}`}
            </button>
          </div>
        )}
      </div>

      {/* Commit log */}
      {initialized && repoLog.commits.length > 0 && (
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold mb-3 text-sm">Recent Commits</h2>
          <ul className="divide-y text-sm">
            {repoLog.commits.map((c) => (
              <li key={c.hash} className="py-2 flex items-start gap-3">
                <span className="font-mono text-xs text-gray-400 mt-0.5 w-14 shrink-0">{c.hash}</span>
                <span className="flex-1 text-gray-800">{c.message}</span>
                {c.unpushed && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium shrink-0">unpushed</span>
                )}
                <span className="text-xs text-gray-400 shrink-0">{new Date(c.date).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
