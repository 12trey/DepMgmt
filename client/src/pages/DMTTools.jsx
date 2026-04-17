import { useEffect, useState, useRef, useCallback } from 'react';
import { RefreshCw, ChevronDown, CheckCircle, XCircle, AlertCircle, Loader2, Settings } from 'lucide-react';

const STORAGE_KEY = 'dmt-wsl-instance';

const DMT_URL = 'http://localhost:7000';
const POLL_INTERVAL = 2000;
const LAUNCH_TIMEOUT = 30000;

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchInstances() {
  const r = await fetch('/api/wsl/instances');
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // { instances: string[] }
}

async function checkSetup(instance) {
  const r = await fetch('/api/wsl/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json(); // { checks, ready }
}

async function launchApp(instance) {
  const r = await fetch('/api/wsl/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function runSetup(instance, onLine) {
  const r = await fetch('/api/wsl/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instance }),
  });
  if (!r.ok) throw new Error(await r.text());

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
        try { onLine(JSON.parse(line)); } catch { /* ignore */ }
      }
    }
  }
}

// ── Status badge ───────────────────────────────────────────────────────────────

function Badge({ ok, label }) {
  if (ok === null) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium
      ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {ok ? <CheckCircle size={11} /> : <XCircle size={11} />}
      {label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DMTTools() {
  const [stage, setStage] = useState('select-instance'); // select-instance | checking | setup-needed | setting-up | launching | ready | error
  const [instances, setInstances] = useState([]);
  const [selectedInstance, setSelectedInstance] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [setupLog, setSetupLog] = useState([]);
  const [error, setError] = useState('');
  const [serviceAvailable, setServiceAvailable] = useState(false);
  const pollRef = useRef(null);
  const launchTimerRef = useRef(null);
  const logBottomRef = useRef(null);

  // Load WSL instances on mount; auto-select the saved default if present
  useEffect(() => {
    fetchInstances()
      .then(({ instances: list }) => {
        setInstances(list);
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && list.includes(saved)) {
          handleInstanceSelect(saved);
        }
      })
      .catch(err => { setError(err.message); setStage('error'); });

    const handler = (event) => {
      if (window.electronAPI?.sendToMain) window.electronAPI.sendToMain(event.data.payload);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll setup log
  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [setupLog]);

  // Poll DMT_URL once we're in launching stage
  const startPolling = useCallback((instance) => {
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += POLL_INTERVAL;
      try {
        await fetch(DMT_URL, { mode: 'no-cors', signal: AbortSignal.timeout(2000) });
        clearInterval(pollRef.current);
        clearTimeout(launchTimerRef.current);
        setServiceAvailable(true);
        setStage('ready');
      } catch {
        if (elapsed >= LAUNCH_TIMEOUT) {
          clearInterval(pollRef.current);
          setError(`Service did not start on port 7000 within ${LAUNCH_TIMEOUT / 1000}s.`);
          setStage('error');
        }
      }
    }, POLL_INTERVAL);
  }, []);

  useEffect(() => () => {
    clearInterval(pollRef.current);
    clearTimeout(launchTimerRef.current);
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleInstanceSelect = async (instance) => {
    if (!instance) return;
    localStorage.setItem(STORAGE_KEY, instance);
    setSelectedInstance(instance);
    setStage('checking');
    setCheckResult(null);
    setError('');
    try {
      const result = await checkSetup(instance);
      setCheckResult(result);
      if (result.ready) {
        // Already set up — check if the service is already running
        try {
          await fetch(DMT_URL, { mode: 'no-cors', signal: AbortSignal.timeout(3000) });
          setServiceAvailable(true);
          setStage('ready');
        } catch {
          setStage('launching');
          await launchApp(instance);
          startPolling(instance);
        }
      } else {
        setStage('setup-needed');
      }
    } catch (err) {
      setError(err.message);
      setStage('error');
    }
  };

  const handleRunSetup = async () => {
    setStage('setting-up');
    setSetupLog([]);
    try {
      await runSetup(selectedInstance, (msg) => {
        setSetupLog(prev => [...prev, msg]);
      });
      // Re-check after setup
      const result = await checkSetup(selectedInstance);
      setCheckResult(result);
      if (result.ready) {
        setStage('launching');
        await launchApp(selectedInstance);
        startPolling(selectedInstance);
      } else {
        setError('Setup finished but environment is still not ready. Check the log above.');
        setStage('error');
      }
    } catch (err) {
      setError(err.message);
      setStage('error');
    }
  };

  const handleLaunch = async () => {
    setStage('launching');
    try {
      await launchApp(selectedInstance);
      startPolling(selectedInstance);
    } catch (err) {
      setError(err.message);
      setStage('error');
    }
  };

  const reset = () => {
    clearInterval(pollRef.current);
    setStage('select-instance');
    setSelectedInstance('');
    setCheckResult(null);
    setSetupLog([]);
    setError('');
    setServiceAvailable(false);
  };

  // ── Render: iframe ───────────────────────────────────────────────────────────

  if (stage === 'ready') {
    return (
      <div className="-m-6 flex flex-col" style={{ height: 'calc(100vh - 0px)' }}>
        <div className="flex items-center justify-between px-3 py-1 bg-gray-50 border-b border-gray-200 shrink-0">
          <span className="text-xs text-gray-500">
            WSL: <strong>{selectedInstance}</strong>
          </span>
          <button
            onClick={() => {
              localStorage.removeItem(STORAGE_KEY);
              reset();
            }}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700"
          >
            <Settings size={11} /> Change instance
          </button>
        </div>
        <iframe
          src={DMT_URL}
          className="w-full flex-1 border-0"
          title="DMT Tools"
          allow="clipboard-read *; clipboard-write *;"
        />
      </div>
    );
  }

  // ── Render: setup flow ───────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center justify-center min-h-64 py-8">
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 w-full max-w-lg space-y-5">

        {/* Header */}
        <div>
          <h2 className="text-base font-semibold text-gray-800">Ansible DMT Tools</h2>
          <p className="text-xs text-gray-500 mt-0.5">Select a WSL instance to host the Ansible UI.</p>
        </div>

        {/* Instance selector */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">WSL Instance</label>
          <div className="relative">
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm appearance-none bg-white pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              value={selectedInstance}
              onChange={e => handleInstanceSelect(e.target.value)}
              disabled={stage !== 'select-instance' && stage !== 'setup-needed'}
            >
              <option value="">-- Select a WSL instance --</option>
              {instances.map(inst => (
                <option key={inst} value={inst}>{inst}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Checking spinner */}
        {stage === 'checking' && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            Checking environment in <strong>{selectedInstance}</strong>…
          </div>
        )}

        {/* Check results */}
        {checkResult && stage === 'setup-needed' && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600">Environment checks:</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge ok={checkResult.checks.node} label={`Node ${checkResult.checks.nodeVersion || ''}`} />
              <Badge ok={checkResult.checks.ansible} label="Ansible" />
              <Badge ok={checkResult.checks.pythonVenv} label="Python venv" />
              <Badge ok={checkResult.checks.appDir} label="App directory" />
              <Badge ok={checkResult.checks.appEntry} label="app.js" />
            </div>
            {checkResult.checks.missingPackages?.length > 0 && (
              <p className="text-xs text-amber-600">
                Missing packages: {checkResult.checks.missingPackages.join(', ')}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={handleRunSetup} className="btn-primary text-sm">
                Run Setup
              </button>
              {checkResult.checks.node && checkResult.checks.appEntry && (
                <button onClick={handleLaunch} className="btn-secondary text-sm">
                  Skip — Launch Anyway
                </button>
              )}
            </div>
          </div>
        )}

        {/* Setup log — visible while running and persisted on error */}
        {(stage === 'setting-up' || (stage === 'error' && setupLog.length > 0)) && (
          <div className="space-y-2">
            {stage === 'setting-up' && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                Running setup…
              </div>
            )}
            <div className="bg-gray-950 text-gray-100 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs space-y-0.5">
              {setupLog.map((msg, i) => (
                <div key={i} className={msg.type === 'stderr' ? 'text-yellow-300' : msg.type === 'error' ? 'text-red-400' : ''}>
                  {msg.line || (msg.type === 'exit' ? `[exit ${msg.code}]` : JSON.stringify(msg))}
                </div>
              ))}
              <div ref={logBottomRef} />
            </div>
          </div>
        )}

        {/* Launching */}
        {stage === 'launching' && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" />
            Launching app… waiting for service on port 7000
          </div>
        )}

        {/* Error */}
        {stage === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
            <div className="flex items-start gap-2 text-sm text-red-700">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <button onClick={reset} className="btn-secondary text-xs">
              <RefreshCw size={12} /> Start Over
            </button>
          </div>
        )}

        {/* Reset link when blocked */}
        {(stage === 'checking' || stage === 'setting-up' || stage === 'launching') && (
          <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
            <RefreshCw size={11} /> Cancel
          </button>
        )}
      </div>
    </div>
  );
}
