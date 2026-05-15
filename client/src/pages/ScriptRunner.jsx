import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Terminal, FolderOpen, FileCode, Play, Square, RefreshCw,
  ChevronRight, ArrowLeft, Download, LogIn, LogOut, CheckCircle,
  AlertCircle, Loader, Cloud, CloudOff, ChevronDown, ChevronUp, X, Maximize2, Minimize2, ExternalLink,
} from 'lucide-react';
import {
  browseScripts, parseScript, getMgGraphStatus, installMgGraph,
  connectMgGraph, mgGraphDisconnect, runScript,
  getAzStatus, installAz, connectAz, azDisconnect,
  openInVscode,
} from '../api';


export default function ScriptRunner() {
  const navigate = useNavigate();

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
  const [azAccountId, setAzAccountId] = useState(() => localStorage.getItem('az_accountId') || '');
  const [azSubId, setAzSubId] = useState(() => localStorage.getItem('az_subId') || '');
  const [azSubName, setAzSubName] = useState(() => localStorage.getItem('az_subName') || '');

  useEffect(() => { localStorage.setItem('az_accountId', azAccountId); }, [azAccountId]);
  useEffect(() => { localStorage.setItem('az_subId', azSubId); }, [azSubId]);
  useEffect(() => { localStorage.setItem('az_subName', azSubName); }, [azSubName]);

  // ── File browser state ────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  const [crumbs, setCrumbs] = useState([]); // [{ name, rel }]
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [noFolder, setNoFolder] = useState(false);
  const [scriptsRoot, setScriptsRoot] = useState('');

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

  // ── JSON depth ────────────────────────────────────────────────────────────
  const [jsonDepth, setJsonDepth] = useState(() => {
    const v = parseInt(localStorage.getItem('script_json_depth') || '10', 10);
    return v >= 2 && v <= 100 ? v : 10;
  });
  useEffect(() => { localStorage.setItem('script_json_depth', String(jsonDepth)); }, [jsonDepth]);

  // ── Run timer / timeout prompt ────────────────────────────────────────────
  const [runMinutes, setRunMinutes] = useState(0);
  const [showTimeoutPrompt, setShowTimeoutPrompt] = useState(false);
  const runTimerRef = useRef(null);
  const runSecondsRef = useRef(0);

  useEffect(() => {
    if (running) {
      runSecondsRef.current = 0;
      setRunMinutes(0);
      setShowTimeoutPrompt(false);
      runTimerRef.current = setInterval(() => {
        runSecondsRef.current += 1;
        if (runSecondsRef.current % 60 === 0) {
          setRunMinutes(runSecondsRef.current / 60);
          setShowTimeoutPrompt(true);
        }
      }, 1000);
    } else {
      clearInterval(runTimerRef.current);
      runTimerRef.current = null;
      setShowTimeoutPrompt(false);
    }
    return () => clearInterval(runTimerRef.current);
  }, [running]);

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
      if (data.scriptsRoot) setScriptsRoot(data.scriptsRoot);
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
      await runScript(scriptRel, paramValues, useMgGraph, useAz, jsonDepth, (evt) => {
        if (evt.type === 'stdout') {
          fullStdoutRef.current += evt.data;
          setConsoleText(prev => prev + evt.data);
        } else if (evt.type === 'stderr') {
          setConsoleText(prev => prev + evt.data);
        } else if (evt.type === 'structured') {
          setStructuredOutput(evt.data);
          setOutputTab('structured');
        } else if (evt.type === 'exit') {
          //setConsoleText(fullStdoutRef.current.trimEnd());
          setExitCode(evt.data);
          setRunning(false);
        } else if (evt.type === 'error') {
          //setConsoleText(prev => prev + `\nError: ${evt.data}\n`);
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
  }, [scriptRel, scriptMeta, paramValues, useMgGraph, useAz, jsonDepth]);

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
          const match = evt.data.match(/Connected as:\s*(.+?)\s*\|\s*Subscription:\s*(.+)/i);
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
      <div className="flex items-center gap-3 mb-6">
        <Terminal size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold">Script Runner</h1>
      </div>
      <div className='text-xs'><button onClick={ () => navigate('/help')}>* Please read Script Runner section in Help *</button></div>
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
            <div className="flex items-center gap-2">
              {scriptsRoot && (
                <button
                  onClick={() => openInVscode(scriptsRoot)}
                  className="text-gray-400 hover:text-blue-600"
                  title="Open scripts folder in VS Code"
                >
                  <ExternalLink size={13} />
                </button>
              )}
            <button
              onClick={() => browseTo(crumbs.length > 0 ? crumbs[crumbs.length - 1].rel : '', crumbs)}
              className="text-gray-400 hover:text-gray-600"
              title="Refresh"
            >
              <RefreshCw size={13} className={browseLoading ? 'animate-spin' : ''} />
            </button>
            </div>
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
                        onLinkSelect={linked => setParamValues(prev => ({ ...prev, ...linked }))}
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
                <div className="flex flex-wrap items-center gap-3 pt-1">
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
                  <div className="ml-auto flex items-center gap-1.5">
                    <label className="text-xs text-gray-500 whitespace-nowrap">JSON Depth</label>
                    <input
                      type="number"
                      min="2"
                      max="100"
                      value={jsonDepth}
                      onChange={e => setJsonDepth(Math.max(2, Math.min(100, parseInt(e.target.value) || 2)))}
                      className="w-16 input text-xs py-1"
                    />
                    {jsonDepth > 10 && (
                      <span className="text-xs text-amber-600 flex items-center gap-1">
                        <AlertCircle size={11} className="shrink-0" /> May hang on complex objects
                      </span>
                    )}
                  </div>
                </div>

                {/* Timeout prompt */}
                {showTimeoutPrompt && running && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-amber-800 flex items-center gap-1.5">
                      <AlertCircle size={14} className="shrink-0" />
                      Script has been running for {runMinutes} minute{runMinutes !== 1 ? 's' : ''}. Still waiting?
                    </span>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setShowTimeoutPrompt(false)}
                        className="text-sm px-3 py-1 border border-amber-400 text-amber-700 rounded hover:bg-amber-100"
                      >
                        Keep Waiting
                      </button>
                      <button
                        onClick={() => { handleStop(); setShowTimeoutPrompt(false); }}
                        className="text-sm px-3 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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
                <label className="block text-xs font-medium text-gray-600 mb-1">Account ID <span className="text-red-500">*</span> <span className="font-normal text-gray-400">(your Microsoft account email)</span></label>
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
                disabled={op !== '' || !accountId.trim()}
                title={!accountId.trim() ? 'Account ID is required' : undefined}
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

function ParamInput({ param, value, onChange, onLinkSelect }) {
  const { name, type, mandatory, default: def, help, options, comboOptions } = param;

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

  if (comboOptions?.length > 0) {
    return (
      <div>
        <Label name={name} type={type} mandatory={mandatory} />
        <ComboBox
          value={value ?? ''}
          onChange={onChange}
          onLinkSelect={onLinkSelect}
          options={comboOptions}
          placeholder={def !== undefined ? `Default: ${def}` : ''}
        />
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

function ComboBox({ value, onChange, onLinkSelect, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = value
    ? options.filter(o => o.value.toLowerCase().includes(value.toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative mt-1">
      <div className="flex">
        <input
          type="text"
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="input flex-1 text-sm"
          style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}
        />
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); setOpen(o => !o); }}
          className="px-2 border border-gray-300 rounded-r bg-gray-50 hover:bg-gray-100 text-gray-500 shrink-0"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-20 left-0 right-0 bg-white border border-gray-200 rounded shadow-lg mt-0.5 max-h-48 overflow-y-auto">
          {filtered.map(o => {
            const hasLinks = Object.keys(o.links).length > 0;
            return (
              <button
                key={o.value}
                type="button"
                title={hasLinks ? `Also sets: ${Object.entries(o.links).map(([k, v]) => `${k} = "${v}"`).join(', ')}` : undefined}
                onMouseDown={e => {
                  e.preventDefault();
                  onChange(o.value);
                  if (hasLinks && onLinkSelect) onLinkSelect(o.links);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 text-gray-700"
              >
                {o.value}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Output Panel ──────────────────────────────────────────────────────────────

function OutputPanel({ tab, onTabChange, consoleText, structuredOutput, running, consoleEndRef }) {
  const [undocked, setUndocked] = useState(false);
  const [pos, setPos] = useState({ x: 40, y: 80 });
  const [size, setSize] = useState(() => ({
    width: Math.min(1100, window.innerWidth - 80),
    height: Math.min(700, window.innerHeight - 120),
  }));
  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  const startDrag = (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y };
    const move = (ev) => setPos({ x: Math.max(0, ev.clientX - dragRef.current.ox), y: Math.max(0, ev.clientY - dragRef.current.oy) });
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const startResize = (e) => {
    e.preventDefault(); e.stopPropagation();
    resizeRef.current = { sx: e.clientX, sy: e.clientY, sw: size.width, sh: size.height };
    const move = (ev) => setSize({
      width: Math.max(480, resizeRef.current.sw + ev.clientX - resizeRef.current.sx),
      height: Math.max(320, resizeRef.current.sh + ev.clientY - resizeRef.current.sy),
    });
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const popOut = () => {
    setPos({ x: Math.max(20, Math.round(window.innerWidth / 2 - size.width / 2)), y: 80 });
    setUndocked(true);
  };

  const hasStructured = structuredOutput !== null && structuredOutput !== undefined;

  const tabs = (
    <div className="flex border-b border-gray-200 bg-gray-50 shrink-0 items-center">
      <TabBtn active={tab === 'console'} onClick={() => onTabChange('console')}>
        Console {running && <Loader size={11} className="animate-spin inline ml-1" />}
      </TabBtn>
      <TabBtn active={tab === 'structured'} onClick={() => hasStructured && onTabChange('structured')} disabled={!hasStructured}>
        Output{hasStructured ? ` (${resultCount(structuredOutput)})` : ''}
      </TabBtn>
      {!undocked && (
        <button onClick={popOut} className="ml-auto mr-2 p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-200" title="Pop out">
          <Maximize2 size={13} />
        </button>
      )}
    </div>
  );

  const content = (
    <div className={undocked ? 'flex-1 min-h-0 flex flex-col p-4' : 'p-4'}>
      {tab === 'console' && (
        <pre className={`text-xs font-mono bg-gray-900 text-gray-100 rounded p-3 overflow-y-auto whitespace-pre-wrap break-words ${undocked ? 'flex-1 min-h-0' : 'min-h-[120px] max-h-[480px]'}`}>
          {consoleText}
          {!consoleText && !running && (
            <span className="text-gray-500 italic">No console output. Pipeline return values appear in the Output tab.</span>
          )}
          <span ref={consoleEndRef} />
        </pre>
      )}
      {tab === 'structured' && hasStructured && (
        <OutputExpandedCtx.Provider value={undocked}>
          <StructuredOutput data={structuredOutput} />
        </OutputExpandedCtx.Provider>
      )}
    </div>
  );

  if (undocked) {
    return (
      <div
        className="fixed z-40 bg-white rounded-lg shadow-2xl flex flex-col border border-gray-300"
        style={{ left: pos.x, top: pos.y, width: size.width, height: size.height, maxWidth: '95vw', maxHeight: '95vh' }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-t-lg border-b border-gray-200 cursor-move shrink-0 select-none"
          onMouseDown={startDrag}
        >
          <Terminal size={13} className="text-gray-500 shrink-0" />
          <span className="text-sm font-semibold text-gray-700 flex-1">Output</span>
          <button onClick={() => setUndocked(false)} className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-200" title="Dock">
            <Minimize2 size={13} />
          </button>
        </div>
        {tabs}
        {content}
        <div
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize rounded-br-lg"
          onMouseDown={startResize}
          style={{ background: 'radial-gradient(circle, #9ca3af 1.5px, transparent 1.5px)', backgroundSize: '4px 4px', backgroundPosition: '2px 2px' }}
        />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {tabs}
      {content}
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

const OutputExpandedCtx = createContext(false);

function StructuredOutput({ data }) {
  const expanded = useContext(OutputExpandedCtx);
  const [stack, setStack] = useState([{ data, label: 'Output' }]);

  useEffect(() => { setStack([{ data, label: 'Output' }]); }, [data]);

  const drillInto = useCallback((value, label) => {
    setStack(prev => [...prev, { data: value, label }]);
  }, []);

  const goBack = () => setStack(prev => prev.slice(0, -1));
  const { data: curData } = stack[stack.length - 1];

  return (
    <div className={expanded ? 'flex flex-col min-h-0 flex-1' : 'space-y-2'}>
      {stack.length > 1 && (
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={goBack} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800">
            <ArrowLeft size={13} /> Back
          </button>
          <span className="text-xs text-gray-400">
            {stack.map((s, i) => (
              <span key={i}>
                {i > 0 && ' › '}
                <span className={i === stack.length - 1 ? 'text-gray-700 font-medium' : ''}>{s.label}</span>
              </span>
            ))}
          </span>
        </div>
      )}
      <div className={expanded ? 'flex-1 min-h-0 flex flex-col' : ''}>
        {renderStructured(curData, drillInto)}
      </div>
    </div>
  );
}

function renderStructured(data, onDrillDown) {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) {
    if (data.length === 0) return <p className="text-sm text-gray-400 italic">Empty result</p>;
    if (typeof data[0] === 'object' && data[0] !== null) {
      return <ObjectTable rows={data} onDrillDown={onDrillDown} />;
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
  if (typeof data === 'object') return <PropertyGrid obj={data} onDrillDown={onDrillDown} />;
  return <div className="text-sm font-mono">{String(data)}</div>;
}

function compareValues(a, b, dir) {
  const aComplex = a === null || a === undefined || typeof a === 'object';
  const bComplex = b === null || b === undefined || typeof b === 'object';
  if (aComplex && bComplex) return 0;
  if (aComplex) return 1;
  if (bComplex) return -1;
  let result;
  if (typeof a === 'number' && typeof b === 'number') result = a - b;
  else if (typeof a === 'boolean' && typeof b === 'boolean') result = a === b ? 0 : a ? -1 : 1;
  else result = String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
  return dir === 'desc' ? -result : result;
}

function ObjectTable({ rows, onDrillDown }) {
  const MAX_ROWS = 200;
  const MAX_COLS = 20;
  const keys = [...new Set(rows.slice(0, MAX_ROWS).flatMap(r => (r && typeof r === 'object') ? Object.keys(r) : []))].slice(0, MAX_COLS);

  const [colWidths, setColWidths] = useState(() => keys.map(() => 140));
  const [detailRow, setDetailRow] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const resizingRef = useRef(null);
  const didResizeRef = useRef(false);

  const startResize = (e, colIdx) => {
    e.preventDefault();
    resizingRef.current = { colIdx, startX: e.clientX, startW: colWidths[colIdx] };
    const onMove = (ev) => {
      didResizeRef.current = true;
      const { colIdx, startX, startW } = resizingRef.current;
      const newW = Math.max(50, startW + ev.clientX - startX);
      setColWidths(prev => { const n = [...prev]; n[colIdx] = newW; return n; });
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => { didResizeRef.current = false; }, 0);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const expanded = useContext(OutputExpandedCtx);

  const handleSort = (k) => {
    if (didResizeRef.current) return;
    if (sortCol === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(k); setSortDir('asc'); }
  };

  const sortedRows = sortCol ? [...rows].sort((a, b) => compareValues(a?.[sortCol], b?.[sortCol], sortDir)) : rows;
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);

  return (
    <div className={expanded ? 'flex flex-col min-h-0 flex-1' : ''}>
      <div className={`overflow-x-auto overflow-y-auto rounded border border-gray-200 ${expanded ? 'flex-1 min-h-0' : 'max-h-[480px]'}`}>
        <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: totalWidth }}>
          <colgroup>
            {keys.map((k, i) => <col key={k} style={{ width: colWidths[i] }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-100">
              {keys.map((k, i) => (
                <th
                  key={k}
                  className="relative px-3 py-2 text-left font-semibold text-gray-600 border-b border-gray-200 overflow-hidden cursor-pointer select-none hover:bg-gray-200"
                  onClick={() => handleSort(k)}
                >
                  <span className="block truncate pr-4">{k}</span>
                  {sortCol === k && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-500">
                      {sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </span>
                  )}
                  <div
                    onMouseDown={e => { e.stopPropagation(); startResize(e, i); }}
                    className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-blue-300"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.slice(0, MAX_ROWS).map((row, i) => (
              <tr
                key={i}
                className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} cursor-pointer hover:bg-blue-50`}
                onDoubleClick={() => setDetailRow(row)}
              >
                {keys.map(k => (
                  <td key={k} className="px-3 py-1.5 border-b border-gray-100 truncate overflow-hidden" title={typeof row?.[k] !== 'object' ? String(row?.[k] ?? '') : undefined}>
                    {renderCellValue(row?.[k], onDrillDown, k)}
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
      {detailRow && (
        <RowDetailModal row={detailRow} onClose={() => setDetailRow(null)} />
      )}
    </div>
  );
}

function PropertyGrid({ obj, onDrillDown }) {
  const expanded = useContext(OutputExpandedCtx);
  const entries = Object.entries(obj);
  return (
    <div className={`overflow-y-auto rounded border border-gray-100 ${expanded ? 'flex-1 min-h-0' : 'max-h-[480px]'}`}>
      <table className="w-full text-sm border-collapse">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-600 whitespace-nowrap w-1/3 align-top">{k}</td>
              <td className="px-3 py-2 text-gray-800 break-words">{renderDeepValue(v, onDrillDown)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowDetailModal({ row, onClose }) {
  const [size, setSize] = useState(() => ({
    width: Math.min(1000, window.innerWidth - 64),
    height: Math.min(700, window.innerHeight - 80),
  }));
  const resizingRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const startModalResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { startX: e.clientX, startY: e.clientY, startW: size.width, startH: size.height };
    const onMove = (ev) => {
      const { startX, startY, startW, startH } = resizingRef.current;
      setSize({
        width: Math.max(480, startW + ev.clientX - startX),
        height: Math.max(320, startH + ev.clientY - startY),
      });
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl flex flex-col relative"
        style={{ width: size.width, height: size.height, maxWidth: '95vw', maxHeight: '95vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shrink-0">
          <span className="text-sm font-semibold text-gray-700">Row Detail</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {Object.entries(row).map(([k, v]) => (
                <tr key={k} className="border-b border-gray-100">
                  <td className="py-2 pr-4 font-medium text-gray-600 whitespace-nowrap align-top w-1/4">{k}</td>
                  <td className="py-2 text-gray-800 break-words"><DetailValue val={v} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div
          className="absolute bottom-0 right-0 w-5 h-5 cursor-se-resize rounded-br-lg"
          onMouseDown={startModalResize}
          style={{ background: 'radial-gradient(circle, #9ca3af 1.5px, transparent 1.5px)', backgroundSize: '4px 4px', backgroundPosition: '2px 2px' }}
        />
      </div>
    </div>
  );
}

function DetailValue({ val, depth = 0 }) {
  if (val === null || val === undefined) return <span className="text-gray-300">—</span>;
  if (typeof val === 'boolean') return <span className={val ? 'text-green-600' : 'text-red-500'}>{String(val)}</span>;
  if (typeof val === 'number') return <span className="text-blue-600">{val}</span>;
  if (typeof val === 'string') return <span>{val}</span>;
  if (depth >= 4) return <span className="text-gray-400 italic text-xs">{Array.isArray(val) ? `[${val.length}]` : '{…}'}</span>;
  if (Array.isArray(val)) {
    if (val.length === 0) return <span className="text-gray-400 italic text-xs">[]</span>;
    if (val.every(v => v === null || typeof v !== 'object')) {
      return <span className="text-gray-700">{val.map(v => String(v ?? '—')).join(', ')}</span>;
    }
    return <DetailObjectTable rows={val} depth={depth} />;
  }
  return (
    <table className="w-full text-xs border-collapse mt-0.5">
      <tbody>
        {Object.entries(val).map(([k, v]) => (
          <tr key={k} className="border-b border-gray-100">
            <td className="py-1 pr-3 font-medium text-gray-500 whitespace-nowrap align-top w-1/3">{k}</td>
            <td className="py-1 text-gray-700 break-words"><DetailValue val={v} depth={depth + 1} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DetailObjectTable({ rows, depth }) {
  const MAX = 100;
  const keys = [...new Set(rows.slice(0, MAX).flatMap(r => (r && typeof r === 'object') ? Object.keys(r) : []))];
  const [colWidths, setColWidths] = useState(() => keys.map(() => 120));
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const resizingRef = useRef(null);
  const didResizeRef = useRef(false);

  const startResize = (e, colIdx) => {
    e.preventDefault();
    resizingRef.current = { colIdx, startX: e.clientX, startW: colWidths[colIdx] };
    const onMove = (ev) => {
      didResizeRef.current = true;
      const { colIdx, startX, startW } = resizingRef.current;
      setColWidths(prev => { const n = [...prev]; n[colIdx] = Math.max(40, startW + ev.clientX - startX); return n; });
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => { didResizeRef.current = false; }, 0);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleSort = (k) => {
    if (didResizeRef.current) return;
    if (sortCol === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(k); setSortDir('asc'); }
  };

  const sortedRows = sortCol ? [...rows].sort((a, b) => compareValues(a?.[sortCol], b?.[sortCol], sortDir)) : rows;
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);

  return (
    <div className="overflow-x-auto mt-1 rounded border border-gray-200">
      <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: totalWidth }}>
        <colgroup>
          {keys.map((k, i) => <col key={k} style={{ width: colWidths[i] }} />)}
        </colgroup>
        <thead>
          <tr className="bg-gray-100">
            {keys.map((k, i) => (
              <th
                key={k}
                className="relative px-2 py-1 text-left font-semibold text-gray-600 border-b border-gray-200 overflow-hidden cursor-pointer select-none hover:bg-gray-200"
                onClick={() => handleSort(k)}
              >
                <span className="block truncate pr-4">{k}</span>
                {sortCol === k && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-500">
                    {sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  </span>
                )}
                <div
                  onMouseDown={e => { e.stopPropagation(); startResize(e, i); }}
                  onClick={e => e.stopPropagation()}
                  className="absolute right-0 top-0 h-full w-2 cursor-col-resize hover:bg-blue-300"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.slice(0, MAX).map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {keys.map(k => (
                <td key={k} className="px-2 py-1 border-b border-gray-100 align-top overflow-hidden">
                  <DetailValue val={row?.[k]} depth={depth + 1} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX && <p className="text-xs text-gray-400 italic px-2 py-1">{rows.length - MAX} more rows not shown</p>}
    </div>
  );
}

function renderCellValue(val, onDrillDown, colKey) {
  if (val === null || val === undefined) return <span className="text-gray-300">—</span>;
  if (typeof val === 'boolean') return <span className={val ? 'text-green-600' : 'text-red-500'}>{String(val)}</span>;
  if (typeof val === 'number') return <span className="text-blue-600">{val}</span>;
  if (typeof val === 'object') {
    const label = Array.isArray(val) ? `[${val.length}]` : '{…}';
    return (
      <button className="text-blue-500 hover:underline italic" onClick={() => onDrillDown(val, colKey)}>
        {label}
      </button>
    );
  }
  return String(val);
}

function renderDeepValue(val, onDrillDown) {
  if (val === null || val === undefined) return <span className="text-gray-300">—</span>;
  if (typeof val === 'boolean') return <span className={val ? 'text-green-600 font-medium' : 'text-red-500'}>{String(val)}</span>;
  if (typeof val === 'number') return <span className="text-blue-600">{val}</span>;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    const label = Array.isArray(val) ? `[${val.length}]` : '{…}';
    return (
      <button className="text-blue-500 hover:underline italic text-xs" onClick={() => onDrillDown(val, label)}>
        {label}
      </button>
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
