import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Terminal, FolderOpen, FileCode, Play, Square, RefreshCw,
  ChevronRight, ArrowLeft, Download, LogIn, LogOut, CheckCircle,
  AlertCircle, Loader, Cloud, CloudOff, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  browseScripts, parseScript, getMgGraphStatus, installMgGraph,
  connectMgGraph, mgGraphDisconnect, runScript,
  getAzStatus, installAz, connectAz, azDisconnect,
} from '../api';

const START_MARKER = '<<<STRUCTURED_RESULT_START>>>';
const END_MARKER = '<<<STRUCTURED_RESULT_END>>>';

export default function ScriptRunner() {
  // ── MgGraph state ──────────────────────────────────────────────────────────
  const [mgStatus, setMgStatus] = useState(null); // { installed, version }
  const [mgConnected, setMgConnected] = useState(false);
  const [mgAccount, setMgAccount] = useState('');
  const [mgOp, setMgOp] = useState(''); // 'installing' | 'connecting' | ''
  const [mgLog, setMgLog] = useState('');
  const [mgLogOpen, setMgLogOpen] = useState(false);
  const [useMgGraph, setUseMgGraph] = useState(false);

  // ── Az state ───────────────────────────────────────────────────────────────
  const [azStatus, setAzStatus] = useState(null);
  const [azConnected, setAzConnected] = useState(false);
  const [azAccount, setAzAccount] = useState('');
  const [azSubscription, setAzSubscription] = useState('');
  const [azOp, setAzOp] = useState('');
  const [azLog, setAzLog] = useState('');
  const [azLogOpen, setAzLogOpen] = useState(false);
  const [useAz, setUseAz] = useState(false);
  const [azAccountId, setAzAccountId] = useState('');
  const [azSubId, setAzSubId] = useState('');
  const [azSubName, setAzSubName] = useState('');

  // ── File browser state ────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [crumbs, setCrumbs] = useState([]); // [{ name, rel }]
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [noFolder, setNoFolder] = useState(false);

  // ── Script state ──────────────────────────────────────────────────────────
  const [scriptRel, setScriptRel] = useState('');
  const [scriptMeta, setScriptMeta] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [paramErrors, setParamErrors] = useState([]);

  // ── Execution state ───────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [exitCode, setExitCode] = useState(null);
  const [consoleText, setConsoleText] = useState('');
  const [structuredOutput, setStructuredOutput] = useState(null);
  const [outputTab, setOutputTab] = useState('console');
  const fullStdoutRef = useRef('');
  const abortRef = useRef(null);
  const consoleEndRef = useRef(null);

  // ── Load module status on mount ───────────────────────────────────────────
  useEffect(() => {
    getMgGraphStatus().then(setMgStatus).catch(() => {});
    getAzStatus().then(setAzStatus).catch(() => {});
  }, []);

  // ── Auto-scroll console ───────────────────────────────────────────────────
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [consoleText]);

  // ── Browse folder ─────────────────────────────────────────────────────────
  const browseTo = useCallback(async (rel, newCrumbs) => {
    setBrowseLoading(true);
    setBrowseError('');
    setNoFolder(false);
    try {
      const data = await browseScripts(rel);
      setItems(data.items);
      setCrumbs(newCrumbs);
    } catch (err) {
      if (err.message.includes('not configured')) {
        setNoFolder(true);
      } else {
        setBrowseError(err.message);
      }
      setItems([]);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  useEffect(() => { browseTo('', []); }, [browseTo]);

  const handleDirClick = (item) => {
    const rel = crumbs.length > 0
      ? crumbs[crumbs.length - 1].rel + '\\' + item.name
      : item.name;
    browseTo(rel, [...crumbs, { name: item.name, rel }]);
  };

  const handleCrumbClick = (idx) => {
    const target = crumbs[idx];
    browseTo(target.rel, crumbs.slice(0, idx + 1));
  };

  const handleBack = () => {
    if (crumbs.length === 0) return;
    const newCrumbs = crumbs.slice(0, -1);
    browseTo(newCrumbs.length > 0 ? newCrumbs[newCrumbs.length - 1].rel : '', newCrumbs);
  };

  // ── Select script ─────────────────────────────────────────────────────────
  const handleScriptClick = useCallback(async (item) => {
    const rel = crumbs.length > 0
      ? crumbs[crumbs.length - 1].rel + '\\' + item.name
      : item.name;
    setScriptRel(rel);
    setScriptMeta(null);
    setParamErrors([]);
    setConsoleText('');
    setStructuredOutput(null);
    setExitCode(null);
    setHasRun(false);
    setOutputTab('console');
    fullStdoutRef.current = '';
    setLoadingMeta(true);
    try {
      const meta = await parseScript(rel);
      setScriptMeta(meta);
      const defaults = {};
      meta.params.forEach(p => {
        if (p.type === 'switch' || p.type === 'bool') {
          defaults[p.name] = p.default ?? false;
        } else {
          defaults[p.name] = p.default !== undefined ? String(p.default) : '';
        }
      });
      setParamValues(defaults);
    } catch (err) {
      setBrowseError(err.message);
    } finally {
      setLoadingMeta(false);
    }
  }, [crumbs]);

  // ── Run script ────────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!scriptMeta) return;
    const errors = scriptMeta.params
      .filter(p => p.mandatory && (paramValues[p.name] === '' || paramValues[p.name] === undefined || paramValues[p.name] === null))
      .map(p => `${p.name} is required`);
    if (errors.length) { setParamErrors(errors); return; }
    setParamErrors([]);
    setRunning(true);
    setHasRun(true);
    setConsoleText('');
    setStructuredOutput(null);
    setExitCode(null);
    setOutputTab('console');
    fullStdoutRef.current = '';

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await runScript(scriptRel, paramValues, useMgGraph, useAz, (evt) => {
        if (evt.type === 'stdout') {
          fullStdoutRef.current += evt.data;
          setConsoleText(prev => prev + evt.data);
        } else if (evt.type === 'stderr') {
          setConsoleText(prev => prev + evt.data);
        } else if (evt.type === 'exit') {
          const full = fullStdoutRef.current;
          const si = full.indexOf(START_MARKER);
          const ei = full.indexOf(END_MARKER);
          let display = full;
          if (si !== -1 && ei !== -1 && ei > si) {
            const jsonStr = full.slice(si + START_MARKER.length, ei).trim();
            display = full.slice(0, si).trimEnd();
            if (jsonStr && jsonStr !== 'null') {
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed !== null && parsed !== undefined) {
                  setStructuredOutput(parsed);
                  setOutputTab('structured');
                }
              } catch {}
            }
          }
          setConsoleText(display);
          setExitCode(evt.data);
          setRunning(false);
        } else if (evt.type === 'error') {
          setConsoleText(prev => prev + `\nError: ${evt.data}\n`);
          setRunning(false);
        }
      }, ctrl.signal);
    } catch (err) {
      if (err.name === 'AbortError') {
        setConsoleText(prev => prev.trimEnd() + '\n\n[Stopped by user]');
      } else {
        setConsoleText(prev => prev + `\nFailed to start: ${err.message}\n`);
      }
      setRunning(false);
    }
  }, [scriptRel, scriptMeta, paramValues, useMgGraph, useAz]);

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  // ── MgGraph operations ────────────────────────────────────────────────────
  const handleInstallMg = async () => {
    setMgOp('installing');
    setMgLog('');
    setMgLogOpen(true);
    try {
      await installMgGraph((evt) => {
        if (evt.type === 'stdout' || evt.type === 'stderr') {
          setMgLog(prev => prev + evt.data);
        } else if (evt.type === 'exit') {
          if (evt.data === 0) getMgGraphStatus().then(setMgStatus).catch(() => {});
        }
      });
    } catch {}
    setMgOp('');
  };

  const handleConnectMg = async () => {
    setMgOp('connecting');
    setMgLog('');
    setMgLogOpen(true);
    setMgConnected(false);
    setMgAccount('');
    try {
      await connectMgGraph((evt) => {
        if (evt.type === 'stdout' || evt.type === 'stderr') {
          setMgLog(prev => prev + evt.data);
          // Parse "Connected as: ..." from the output
          const match = evt.data.match(/Connected as:\s*(.+)/i);
          if (match) {
            setMgConnected(true);
            setMgAccount(match[1].trim());
          }
        } else if (evt.type === 'exit') {
          if (evt.data === 0) setMgConnected(true);
        }
      });
    } catch {}
    setMgOp('');
  };

  const handleDisconnectMg = async () => {
    try {
      await mgGraphDisconnect();
      setMgConnected(false);
      setMgAccount('');
      setUseMgGraph(false);
    } catch {}
  };

  // ── Az operations ─────────────────────────────────────────────────────────
  const handleInstallAz = async () => {
    setAzOp('installing');
    setAzLog('');
    setAzLogOpen(true);
    try {
      await installAz((evt) => {
        if (evt.type === 'stdout' || evt.type === 'stderr') {
          setAzLog(prev => prev + evt.data);
        } else if (evt.type === 'exit') {
          if (evt.data === 0) getAzStatus().then(setAzStatus).catch(() => {});
        }
      });
    } catch {}
    setAzOp('');
  };

  const handleConnectAz = async () => {
    setAzOp('connecting');
    setAzLog('');
    setAzLogOpen(true);
    setAzConnected(false);
    setAzAccount('');
    setAzSubscription('');
    try {
      await connectAz(azAccountId, azSubId, azSubName, (evt) => {
        if (evt.type === 'stdout' || evt.type === 'stderr') {
          setAzLog(prev => prev + evt.data);
          const match = evt.data.match(/Connected as:\s*(.+?)\s*\/\s*Subscription:\s*(.+)/i);
          if (match) {
            setAzConnected(true);
            setAzAccount(match[1].trim());
            setAzSubscription(match[2].trim());
          }
        } else if (evt.type === 'exit') {
          if (evt.data === 0) setAzConnected(true);
        }
      });
    } catch {}
    setAzOp('');
  };

  const handleDisconnectAz = async () => {
    try {
      await azDisconnect();
      setAzConnected(false);
      setAzAccount('');
      setAzSubscription('');
      setUseAz(false);
    } catch {}
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Terminal size={24} />
        Script Runner
      </h1>

      {/* MgGraph panel */}
      <MgGraphPanel
        status={mgStatus}
        connected={mgConnected}
        account={mgAccount}
        op={mgOp}
        log={mgLog}
        logOpen={mgLogOpen}
        setLogOpen={setMgLogOpen}
        useMgGraph={useMgGraph}
        setUseMgGraph={setUseMgGraph}
        onInstall={handleInstallMg}
        onConnect={handleConnectMg}
        onDisconnect={handleDisconnectMg}
      />

      {/* Az panel */}
      <AzPanel
        status={azStatus}
        connected={azConnected}
        account={azAccount}
        subscription={azSubscription}
        op={azOp}
        log={azLog}
        logOpen={azLogOpen}
        setLogOpen={setAzLogOpen}
        useAz={useAz}
        setUseAz={setUseAz}
        accountId={azAccountId}
        subId={azSubId}
        subName={azSubName}
        onAccountIdChange={setAzAccountId}
        onSubIdChange={setAzSubId}
        onSubNameChange={setAzSubName}
        onInstall={handleInstallAz}
        onConnect={handleConnectAz}
        onDisconnect={handleDisconnectAz}
      />

      {/* Two-column layout */}
      <div className="flex gap-4 items-start">
        {/* File browser */}
        <div className="w-72 shrink-0 bg-white rounded-lg shadow overflow-hidden">
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <FolderOpen size={14} /> Scripts
            </span>
            <button
              onClick={() => browseTo(crumbs.length > 0 ? crumbs[crumbs.length - 1].rel : '', crumbs)}
              className="text-gray-400 hover:text-gray-600"
              title="Refresh"
            >
              <RefreshCw size={13} className={browseLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Breadcrumb */}
          {(crumbs.length > 0 || browseLoading) && (
            <div className="px-3 py-1.5 border-b border-gray-100 flex items-center gap-1 text-xs text-gray-500 overflow-x-auto">
              <button
                onClick={handleBack}
                disabled={crumbs.length === 0}
                className="text-gray-400 hover:text-gray-700 disabled:opacity-30 shrink-0"
              >
                <ArrowLeft size={13} />
              </button>
              <button onClick={() => browseTo('', [])} className="hover:text-blue-600 shrink-0">
                root
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1 shrink-0">
                  <ChevronRight size={10} />
                  <button onClick={() => handleCrumbClick(i)} className="hover:text-blue-600">
                    {c.name}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Items */}
          <div className="max-h-96 overflow-y-auto">
            {noFolder ? (
              <div className="px-4 py-6 text-center">
                <FolderOpen size={28} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-500">No scripts folder configured.</p>
                <p className="text-xs text-gray-400 mt-1">Set it in Settings.</p>
              </div>
            ) : browseError ? (
              <div className="px-4 py-3 text-sm text-red-600">{browseError}</div>
            ) : browseLoading ? (
              <div className="px-4 py-6 flex justify-center">
                <Loader size={20} className="animate-spin text-gray-400" />
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-400">No scripts found</div>
            ) : (
              items.map((item) => (
                <button
                  key={item.name}
                  onClick={() => item.type === 'dir' ? handleDirClick(item) : handleScriptClick(item)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 border-b border-gray-50 ${
                    item.type === 'file' && scriptRel.endsWith(item.name)
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700'
                  }`}
                >
                  {item.type === 'dir'
                    ? <FolderOpen size={14} className="text-yellow-500 shrink-0" />
                    : <FileCode size={14} className="text-blue-500 shrink-0" />}
                  <span className="truncate">{item.name}</span>
                  {item.type === 'dir' && <ChevronRight size={12} className="ml-auto text-gray-400 shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Script workspace */}
        <div className="flex-1 space-y-4 min-w-0">
          {!scriptRel ? (
            <div className="bg-white rounded-lg shadow px-6 py-12 text-center text-gray-400">
              <FileCode size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm">Select a script from the browser</p>
            </div>
          ) : loadingMeta ? (
            <div className="bg-white rounded-lg shadow px-6 py-12 flex justify-center">
              <Loader size={20} className="animate-spin text-gray-400" />
            </div>
          ) : scriptMeta ? (
            <>
              {/* Script header + params */}
              <div className="bg-white rounded-lg shadow p-5 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <FileCode size={16} className="text-blue-500" />
                    {scriptMeta.name}
                  </h2>
                  {scriptMeta.description && (
                    <p className="text-sm text-gray-500 mt-1">{scriptMeta.description}</p>
                  )}
                </div>

                {/* Params form */}
                {scriptMeta.params.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {scriptMeta.params.map(param => (
                      <ParamInput
                        key={param.name}
                        param={param}
                        value={paramValues[param.name]}
                        onChange={v => setParamValues(prev => ({ ...prev, [param.name]: v }))}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No parameters</p>
                )}

                {/* Validation errors */}
                {paramErrors.length > 0 && (
                  <div className="rounded bg-red-50 border border-red-200 p-3 space-y-1">
                    {paramErrors.map((e, i) => (
                      <p key={i} className="text-sm text-red-700 flex items-center gap-1.5">
                        <AlertCircle size={13} /> {e}
                      </p>
                    ))}
                  </div>
                )}

                {/* Run controls */}
                <div className="flex items-center gap-3 pt-1">
                  {!running ? (
                    <button onClick={handleRun} className="btn-primary flex items-center gap-2">
                      <Play size={14} /> Run Script
                    </button>
                  ) : (
                    <button onClick={handleStop} className="btn-secondary flex items-center gap-2 text-red-600 border-red-300 hover:bg-red-50">
                      <Square size={14} /> Stop
                    </button>
                  )}
                  {useMgGraph && (
                    <span className="text-xs text-blue-600 flex items-center gap-1">
                      <Cloud size={13} /> Using Microsoft Graph
                    </span>
                  )}
                  {useAz && (
                    <span className="text-xs text-blue-400 flex items-center gap-1">
                      <Cloud size={13} /> Using Az
                    </span>
                  )}
                  {exitCode !== null && !running && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      exitCode === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      Exit {exitCode} {exitCode === 0 ? '✓' : '✗'}
                    </span>
                  )}
                </div>
              </div>

              {/* Output panel — stays visible once the script has been run */}
              {(running || hasRun) && (
                <OutputPanel
                  tab={outputTab}
                  onTabChange={setOutputTab}
                  consoleText={consoleText}
                  structuredOutput={structuredOutput}
                  running={running}
                  consoleEndRef={consoleEndRef}
                />
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── MgGraph Panel ─────────────────────────────────────────────────────────────

function MgGraphPanel({ status, connected, account, op, log, logOpen, setLogOpen, useMgGraph, setUseMgGraph, onInstall, onConnect, onDisconnect }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <Cloud size={16} className="text-blue-500" />
          Microsoft Graph
          {connected && (
            <span className="text-xs font-normal text-green-600 flex items-center gap-1">
              <CheckCircle size={11} /> Connected{account ? ` · ${account}` : ''}
            </span>
          )}
        </span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {/* Module status */}
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              {status === null ? (
                <Loader size={14} className="animate-spin text-gray-400" />
              ) : status.installed ? (
                <CheckCircle size={14} className="text-green-500" />
              ) : (
                <CloudOff size={14} className="text-gray-400" />
              )}
              <span className="text-gray-600">
                {status === null ? 'Checking...' : status.installed
                  ? `Module installed (v${status.version})`
                  : 'Module not installed'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {connected
                ? <CheckCircle size={14} className="text-green-500" />
                : <AlertCircle size={14} className="text-gray-400" />}
              <span className="text-gray-600">
                {connected ? `Connected${account ? ` as ${account}` : ''}` : 'Not connected'}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {status && !status.installed && (
              <button
                onClick={onInstall}
                disabled={op !== ''}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                {op === 'installing'
                  ? <><Loader size={13} className="animate-spin" /> Installing...</>
                  : <><Download size={13} /> Install Module</>}
              </button>
            )}
            {status?.installed && !connected && (
              <button
                onClick={onConnect}
                disabled={op !== ''}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {op === 'connecting'
                  ? <><Loader size={13} className="animate-spin" /> Connecting...</>
                  : <><LogIn size={13} /> Connect to Microsoft Graph</>}
              </button>
            )}
            {connected && (
              <button onClick={onDisconnect} className="btn-secondary text-sm flex items-center gap-1.5">
                <LogOut size={13} /> Disconnect
              </button>
            )}

            {/* Use Graph toggle */}
            {status?.installed && (
              <label className="ml-auto flex items-center gap-2 cursor-pointer select-none">
                <span className="text-sm text-gray-600">Use Graph in scripts</span>
                <div
                  onClick={() => setUseMgGraph(v => !v)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${useMgGraph ? 'bg-blue-500' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${useMgGraph ? 'translate-x-4' : ''}`} />
                </div>
              </label>
            )}
          </div>

          {/* Streaming log */}
          {log && (
            <div>
              <button
                onClick={() => setLogOpen(o => !o)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
              >
                {logOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {logOpen ? 'Hide log' : 'Show log'}
              </button>
              {logOpen && (
                <pre className="mt-2 text-xs font-mono bg-gray-900 text-gray-200 rounded p-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
                  {log}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Az Panel ──────────────────────────────────────────────────────────────────

function AzPanel({ status, connected, account, subscription, op, log, logOpen, setLogOpen, useAz, setUseAz, accountId, subId, subName, onAccountIdChange, onSubIdChange, onSubNameChange, onInstall, onConnect, onDisconnect }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
      >
        <span className="flex items-center gap-2">
          <Cloud size={16} className="text-blue-400" />
          Azure PowerShell (Az)
          {connected && (
            <span className="text-xs font-normal text-green-600 flex items-center gap-1">
              <CheckCircle size={11} /> Connected{account ? ` · ${account}` : ''}{subscription ? ` / ${subscription}` : ''}
            </span>
          )}
        </span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4">
          {/* Module status */}
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              {status === null ? (
                <Loader size={14} className="animate-spin text-gray-400" />
              ) : status.installed ? (
                <CheckCircle size={14} className="text-green-500" />
              ) : (
                <CloudOff size={14} className="text-gray-400" />
              )}
              <span className="text-gray-600">
                {status === null ? 'Checking...' : status.installed
                  ? `Az.Accounts installed (v${status.version})`
                  : 'Az module not installed'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {connected
                ? <CheckCircle size={14} className="text-green-500" />
                : <AlertCircle size={14} className="text-gray-400" />}
              <span className="text-gray-600">
                {connected
                  ? `Connected${account ? ` as ${account}` : ''}${subscription ? ` / ${subscription}` : ''}`
                  : 'Not connected'}
              </span>
            </div>
          </div>

          {/* Login fields — shown when installed but not yet connected */}
          {status?.installed && !connected && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Account ID <span className="font-normal text-gray-400">(your Microsoft account email — recommended)</span></label>
                <input
                  className="input w-full text-sm"
                  placeholder="user@domain.com"
                  value={accountId}
                  onChange={e => onAccountIdChange(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subscription ID <span className="font-normal text-gray-400">(optional)</span></label>
                  <input
                    className="input w-full text-sm"
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    value={subId}
                    onChange={e => onSubIdChange(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subscription Name <span className="font-normal text-gray-400">(optional)</span></label>
                  <input
                    className="input w-full text-sm"
                    placeholder="My Azure Subscription"
                    value={subName}
                    onChange={e => onSubNameChange(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {status && !status.installed && (
              <button
                onClick={onInstall}
                disabled={op !== ''}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                {op === 'installing'
                  ? <><Loader size={13} className="animate-spin" /> Installing...</>
                  : <><Download size={13} /> Install Az Module</>}
              </button>
            )}
            {status?.installed && !connected && (
              <button
                onClick={onConnect}
                disabled={op !== ''}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {op === 'connecting'
                  ? <><Loader size={13} className="animate-spin" /> Connecting...</>
                  : <><LogIn size={13} /> Connect with Connect-AzAccount</>}
              </button>
            )}
            {connected && (
              <button onClick={onDisconnect} className="btn-secondary text-sm flex items-center gap-1.5">
                <LogOut size={13} /> Disconnect
              </button>
            )}

            {/* Use Az toggle */}
            {status?.installed && (
              <label className="ml-auto flex items-center gap-2 cursor-pointer select-none">
                <span className="text-sm text-gray-600">Use Az in scripts</span>
                <div
                  onClick={() => setUseAz(v => !v)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${useAz ? 'bg-blue-500' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${useAz ? 'translate-x-4' : ''}`} />
                </div>
              </label>
            )}
          </div>

          {/* Streaming log */}
          {log && (
            <div>
              <button
                onClick={() => setLogOpen(o => !o)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
              >
                {logOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {logOpen ? 'Hide log' : 'Show log'}
              </button>
              {logOpen && (
                <pre className="mt-2 text-xs font-mono bg-gray-900 text-gray-200 rounded p-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
                  {log}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Parameter Input ───────────────────────────────────────────────────────────

function ParamInput({ param, value, onChange }) {
  const { name, type, mandatory, default: def, help, options } = param;

  if (type === 'switch' || type === 'bool') {
    return (
      <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
        <input
          type="checkbox"
          checked={value === true || value === 'true'}
          onChange={e => onChange(e.target.checked)}
          className="mt-0.5 rounded"
        />
        <div>
          <span className="text-sm font-medium text-gray-700">{name}</span>
          <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{type}</span>
          {help && <p className="text-xs text-gray-400 mt-0.5">{help}</p>}
        </div>
      </label>
    );
  }

  if (type === 'select') {
    return (
      <div>
        <Label name={name} type={type} mandatory={mandatory} />
        <select
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          className="input w-full mt-1 text-sm"
        >
          <option value="">— Select —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {help && <p className="text-xs text-gray-400 mt-1">{help}</p>}
      </div>
    );
  }

  const inputType =
    type === 'password' ? 'password' :
    type === 'int' || type === 'float' ? 'number' :
    type === 'datetime' ? 'datetime-local' :
    'text';

  return (
    <div>
      <Label name={name} type={type} mandatory={mandatory} />
      <input
        type={inputType}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={def !== undefined ? `Default: ${def}` : ''}
        className="input w-full mt-1 text-sm"
        step={type === 'float' ? '0.01' : type === 'int' ? '1' : undefined}
      />
      {help && <p className="text-xs text-gray-400 mt-1">{help}</p>}
    </div>
  );
}

function Label({ name, type, mandatory }) {
  return (
    <span className="text-sm font-medium text-gray-700">
      {name}
      {mandatory && <span className="text-red-500 ml-0.5">*</span>}
      <span className="ml-1.5 text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{type}</span>
    </span>
  );
}

// ── Output Panel ──────────────────────────────────────────────────────────────

function OutputPanel({ tab, onTabChange, consoleText, structuredOutput, running, consoleEndRef }) {
  const hasStructured = structuredOutput !== null && structuredOutput !== undefined;
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50">
        <TabBtn active={tab === 'console'} onClick={() => onTabChange('console')}>
          Console {running && <Loader size={11} className="animate-spin inline ml-1" />}
        </TabBtn>
        <TabBtn
          active={tab === 'structured'}
          onClick={() => hasStructured && onTabChange('structured')}
          disabled={!hasStructured}
        >
          Output{hasStructured ? ` (${resultCount(structuredOutput)})` : ''}
        </TabBtn>
      </div>

      <div className="p-4">
        {tab === 'console' && (
          <pre className="text-xs font-mono bg-gray-900 text-gray-100 rounded p-3 min-h-[120px] max-h-[480px] overflow-y-auto whitespace-pre-wrap break-words">
            {consoleText}
            {!consoleText && !running && (
              <span className="text-gray-500 italic">No console output. Pipeline return values appear in the Output tab.</span>
            )}
            <span ref={consoleEndRef} />
          </pre>
        )}
        {tab === 'structured' && hasStructured && (
          <StructuredOutput data={structuredOutput} />
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, disabled, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-blue-500 text-blue-600'
          : disabled
            ? 'border-transparent text-gray-300 cursor-not-allowed'
            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  );
}

function resultCount(data) {
  if (Array.isArray(data)) return data.length;
  if (data !== null && typeof data === 'object') return `${Object.keys(data).length} props`;
  return 1;
}

// ── Structured Output ─────────────────────────────────────────────────────────

function StructuredOutput({ data }) {
  if (data === null || data === undefined) return null;

  if (Array.isArray(data)) {
    if (data.length === 0) return <p className="text-sm text-gray-400 italic">Empty result</p>;
    if (typeof data[0] === 'object' && data[0] !== null) {
      return <ObjectTable rows={data} />;
    }
    return (
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {data.slice(0, 500).map((item, i) => (
          <div key={i} className="text-sm py-1 px-2 border-b border-gray-100 font-mono">
            {renderScalar(item)}
          </div>
        ))}
        {data.length > 500 && (
          <p className="text-xs text-gray-400 italic px-2 py-1">{data.length - 500} more items not shown</p>
        )}
      </div>
    );
  }

  if (typeof data === 'object') return <PropertyGrid obj={data} />;

  return <div className="text-sm font-mono">{String(data)}</div>;
}

function ObjectTable({ rows }) {
  const MAX_ROWS = 200;
  const MAX_COLS = 20;
  const keys = [...new Set(rows.slice(0, MAX_ROWS).flatMap(r => (r && typeof r === 'object') ? Object.keys(r) : []))].slice(0, MAX_COLS);

  return (
    <div>
      <div className="overflow-x-auto max-h-[480px] overflow-y-auto rounded border border-gray-200">
        <table className="w-full text-xs border-collapse min-w-max">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100">
              {keys.map(k => (
                <th key={k} className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                {keys.map(k => (
                  <td key={k} className="px-3 py-1.5 border-b border-gray-100 max-w-[220px] truncate" title={String(row?.[k] ?? '')}>
                    {renderCellValue(row?.[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > MAX_ROWS && (
        <p className="text-xs text-gray-400 italic mt-1">{rows.length - MAX_ROWS} more rows not shown</p>
      )}
    </div>
  );
}

function PropertyGrid({ obj }) {
  const entries = Object.entries(obj);
  return (
    <div className="overflow-y-auto max-h-[480px] rounded border border-gray-100">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-600 whitespace-nowrap w-1/3 align-top">{k}</td>
              <td className="px-3 py-2 text-gray-800 break-words">{renderDeepValue(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCellValue(val) {
  if (val === null || val === undefined) return <span className="text-gray-300">—</span>;
  if (typeof val === 'boolean') return <span className={val ? 'text-green-600' : 'text-red-500'}>{String(val)}</span>;
  if (typeof val === 'number') return <span className="text-blue-600">{val}</span>;
  if (typeof val === 'object') return <span className="text-gray-400 italic">{Array.isArray(val) ? `[${val.length}]` : '{…}'}</span>;
  return String(val);
}

function renderDeepValue(val, depth = 0) {
  if (val === null || val === undefined) return <span className="text-gray-300">—</span>;
  if (typeof val === 'boolean') return <span className={val ? 'text-green-600 font-medium' : 'text-red-500'}>{String(val)}</span>;
  if (typeof val === 'number') return <span className="text-blue-600">{val}</span>;
  if (typeof val === 'string') return val;
  if (depth >= 2) return <span className="text-gray-400 italic">{Array.isArray(val) ? `[Array(${val.length})]` : '[Object]'}</span>;
  if (Array.isArray(val)) {
    if (val.length === 0) return <span className="text-gray-400">[]</span>;
    if (typeof val[0] === 'object' && val[0] !== null) {
      return <span className="text-gray-500 italic">[{val.length} objects]</span>;
    }
    return <span className="text-gray-700">{val.map(v => renderScalar(v)).join(', ')}</span>;
  }
  if (typeof val === 'object') {
    return (
      <div className="pl-2 border-l-2 border-gray-100 space-y-0.5 text-xs">
        {Object.entries(val).slice(0, 10).map(([k, v]) => (
          <div key={k}><span className="font-medium text-gray-500">{k}: </span>{renderDeepValue(v, depth + 1)}</div>
        ))}
        {Object.keys(val).length > 10 && <div className="text-gray-400">…+{Object.keys(val).length - 10} more</div>}
      </div>
    );
  }
  return String(val);
}

function renderScalar(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return String(val);
  if (typeof val === 'object') return Array.isArray(val) ? `[${val.length}]` : '{…}';
  return String(val);
}
