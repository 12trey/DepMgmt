import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { gitClone, gitPull, gitPush, gitLog, getConfig } from '../api';
import { GitBranch, ArrowUp, ArrowDown, RefreshCw, Upload, Download, KeyRound } from 'lucide-react';
import { useConfigContext } from '../context/ConfigContext';
import { useTabGuard } from '../context/TabGuardContext';

export default function GitPanel() {
  const [repoLog, setRepoLog] = useState(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showCreds, setShowCreds] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState('');

  // Register a tab-close guard so App.jsx can warn before discarding credentials
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = !!(username || password); }, [username, password]);
  useTabGuard('/git', () => dirtyRef.current);

  const { configVersion } = useConfigContext();
  const loadLog = () => gitLog().then(setRepoLog).catch(() => {});
  useEffect(() => {
    loadLog();
    getConfig().then((c) => setRepoUrl(c.repository?.url || '')).catch(() => {});
  }, [configVersion]);

  const credentials = { username: username || undefined, password: password || undefined };

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
      <div className="flex items-center gap-3 mb-6">
        <GitBranch size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold">Git Repository</h1>
      </div>
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

        {/* Optional credentials */}
        <div>
          <button
            onClick={() => setShowCreds(v => !v)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
          >
            <KeyRound size={14} />
            {showCreds ? 'Hide credentials' : 'Credentials (optional)'}
          </button>
          {showCreds && (
            <div className="mt-2 flex gap-2">
              <input
                className="input flex-1"
                placeholder="Username"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                className="input flex-1"
                type="password"
                placeholder="Password or token"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Repository</label>
          {repoUrl ? (
            <div className="flex gap-2 items-center">
              <span className="input flex-1 bg-gray-50 text-gray-600 truncate select-all">{repoUrl}</span>
              <button onClick={() => action('clone', () => gitClone('', credentials))} disabled={!!loading} className="btn-primary flex-shrink-0">
                {loading === 'clone' ? 'Cloning…' : 'Clone'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-amber-600">
              No repository URL configured.{' '}
              <Link to="/config" className="underline hover:text-amber-800">Set one in Settings.</Link>
            </p>
          )}
        </div>

        {initialized && (
          <div className="flex gap-3 pt-1 border-t">
            <button onClick={() => action('pull', gitPull)} disabled={!!loading} className="btn-secondary">
              <Download size={15} /> {loading === 'pull' ? 'Pulling…' : 'Pull'}
            </button>
            <button onClick={() => action('push', () => gitPush(credentials))} disabled={!!loading} className="btn-primary">
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
