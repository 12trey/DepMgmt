import { useEffect, useRef, useState, useCallback } from 'react';
import { Download, FolderOpen, FileSearch, Package, CheckCircle, AlertCircle, Play, Archive } from 'lucide-react';
import { getIntuneToolStatus, downloadIntuneTool, buildIntuneWin, checkIntuneOutput, clearIntuneOutput } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';

const isElectron = !!window.electronAPI?.isElectron;

async function pickFolder() {
  if (isElectron) return window.electronAPI.pickFolder();
  return null;
}

async function pickFile(filters = []) {
  if (isElectron) return window.electronAPI.pickFile({ filters });
  return null;
}

export default function IntuneWin() {
  const [toolStatus, setToolStatus] = useState(null); // null = loading
  const [downloading, setDownloading] = useState(false);
  const [downloadExecId, setDownloadExecId] = useState(null);

  const [form, setForm] = useState({
    setupFolder: '',
    sourceFile: '',
    outputFolder: '',
    addCatalog: false,
    catalogFolder: '',
  });
  const [confirmClear, setConfirmClear] = useState(null); // { count } when prompt is open
  const [building, setBuilding] = useState(false);
  const [buildExecId, setBuildExecId] = useState(null);
  const [buildDone, setBuildDone] = useState(false);
  const [error, setError] = useState('');

  const { messages: downloadMsgs, subscribe: subDownload, clear: clearDownload } = useWebSocket(downloadExecId);
  const { messages: buildMsgs, subscribe: subBuild, clear: clearBuild } = useWebSocket(buildExecId);

  const downloadTermRef = useRef();
  const buildTermRef = useRef();

  const refreshStatus = useCallback(() => {
    getIntuneToolStatus()
      .then(setToolStatus)
      .catch(() => setToolStatus({ installed: false, version: null }));
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (downloadTermRef.current) {
      downloadTermRef.current.scrollTop = downloadTermRef.current.scrollHeight;
    }
  }, [downloadMsgs]);

  useEffect(() => {
    if (buildTermRef.current) {
      buildTermRef.current.scrollTop = buildTermRef.current.scrollHeight;
    }
  }, [buildMsgs]);

  // Watch for __DONE__ sentinel from download
  useEffect(() => {
    if (!downloading) return;
    const last = downloadMsgs[downloadMsgs.length - 1];
    if (last?.text === '__DONE__') {
      setDownloading(false);
      refreshStatus();
    }
  }, [downloadMsgs, downloading, refreshStatus]);

  // Watch for build completion
  useEffect(() => {
    if (!building) return;
    const last = buildMsgs[buildMsgs.length - 1];
    if (last) {
      const text = last.text || '';
      if (text.includes('Build completed successfully') || text.includes('exited with code')) {
        setBuilding(false);
        setBuildDone(true);
      }
    }
  }, [buildMsgs, building]);

  const handleDownload = async () => {
    clearDownload();
    setDownloading(true);
    setError('');
    try {
      const result = await downloadIntuneTool();
      setDownloadExecId(result.id);
      subDownload(result.id);
    } catch (err) {
      setError(err.message);
      setDownloading(false);
    }
  };

  const startBuild = async () => {
    clearBuild();
    setBuilding(true);
    setBuildDone(false);
    setError('');
    try {
      const result = await buildIntuneWin(form);
      setBuildExecId(result.id);
      subBuild(result.id);
    } catch (err) {
      setError(err.message);
      setBuilding(false);
    }
  };

  const handleBuild = async () => {
    if (!form.setupFolder || !form.sourceFile || !form.outputFolder) {
      setError('Setup folder, source file, and output folder are all required.');
      return;
    }
    setError('');
    try {
      const { hasContent, count } = await checkIntuneOutput(form.outputFolder);
      if (hasContent) {
        setConfirmClear({ count });
        return;
      }
    } catch {
      // If check fails, proceed anyway
    }
    await startBuild();
  };

  const handleConfirmClear = async (confirmed) => {
    setConfirmClear(null);
    if (!confirmed) return;
    try {
      await clearIntuneOutput(form.outputFolder);
    } catch (err) {
      setError(`Failed to clear output folder: ${err.message}`);
      return;
    }
    await startBuild();
  };

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handlePickFolder = async (key) => {
    const folder = await pickFolder();
    if (folder) {
      set(key, folder);
      // Auto-fill output folder to same dir if not set
      if (key === 'setupFolder' && !form.outputFolder) set('outputFolder', folder);
    }
  };

  const handlePickFile = async () => {
    const file = await pickFile([
      { name: 'Setup files', extensions: ['exe', 'msi', 'ps1', 'cmd', 'bat'] },
      { name: 'All files', extensions: ['*'] },
    ]);
    if (file) set('sourceFile', file);
  };

  // Visible download messages (filter out __DONE__ sentinel)
  const visibleDownloadMsgs = downloadMsgs.filter((m) => m.text !== '__DONE__');

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Archive size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold">Intune Win32 Packager</h1>
      </div>
      <p className="text-sm text-gray-500 -mt-4">
        Create <code className="bg-gray-100 px-1 rounded">.intunewin</code> packages using Microsoft's IntuneWinAppUtil.
      </p>

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded flex items-center gap-2 text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Tool status */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Package size={18} />
          IntuneWinAppUtil.exe
        </h2>

        {toolStatus === null ? (
          <p className="text-sm text-gray-400">Checking...</p>
        ) : toolStatus.installed ? (
          <div className="flex items-center gap-3">
            <CheckCircle size={18} className="text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-700">Tool is ready</p>
              {toolStatus.version && (
                <p className="text-xs text-gray-400">{toolStatus.version}</p>
              )}
              <p className="text-xs text-gray-400 font-mono">{toolStatus.path}</p>
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="ml-auto btn-secondary text-xs"
            >
              <Download size={14} /> Re-download
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-700">Tool not found</p>
              <p className="text-xs text-gray-400">
                IntuneWinAppUtil.exe will be downloaded from the official Microsoft GitHub repository.
              </p>
            </div>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="ml-auto btn-primary text-sm"
            >
              <Download size={16} /> {downloading ? 'Downloading...' : 'Download'}
            </button>
          </div>
        )}

        {/* Download terminal */}
        {(visibleDownloadMsgs.length > 0) && (
          <div
            ref={downloadTermRef}
            className="mt-4 bg-gray-900 rounded p-3 max-h-48 overflow-auto font-mono text-xs space-y-0.5"
          >
            {visibleDownloadMsgs.map((m, i) => (
              <div
                key={i}
                className={
                  m.stream === 'stderr'
                    ? 'text-red-400'
                    : m.stream === 'system'
                    ? 'text-blue-300'
                    : 'text-green-300'
                }
              >
                {m.text || '\u00A0'}
              </div>
            ))}
            {downloading && (
              <div className="text-gray-400 animate-pulse">...</div>
            )}
          </div>
        )}
      </div>

      {/* Build form */}
      {toolStatus?.installed && (
        <div className="bg-white rounded-lg shadow p-5 space-y-4">
          <h2 className="font-semibold text-lg">Package Settings</h2>

          {/* Setup Folder */}
          <PathField
            label="Setup Folder"
            hint="-c  The folder containing all setup files"
            value={form.setupFolder}
            onChange={(v) => set('setupFolder', v)}
            onPick={() => handlePickFolder('setupFolder')}
            icon={<FolderOpen size={15} />}
          />

          {/* Source File */}
          <PathField
            label="Source Setup File"
            hint="-s  The setup file within the setup folder (e.g. setup.exe)"
            value={form.sourceFile}
            onChange={(v) => set('sourceFile', v)}
            onPick={isElectron ? handlePickFile : null}
            pickLabel="Browse"
            icon={<FileSearch size={15} />}
            placeholder="setup.exe"
          />

          {/* Output Folder */}
          <PathField
            label="Output Folder"
            hint="-o  Where the .intunewin file will be saved"
            value={form.outputFolder}
            onChange={(v) => set('outputFolder', v)}
            onPick={() => handlePickFolder('outputFolder')}
            icon={<FolderOpen size={15} />}
          />

          {/* Options */}
          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.addCatalog}
                onChange={(e) => set('addCatalog', e.target.checked)}
                className="accent-blue-600"
              />
              <span className="text-sm font-medium">Specify catalog folder</span>
              <span className="text-xs text-gray-400">(-a) folder containing catalog files</span>
            </label>

            {form.addCatalog && (
              <div className="ml-6">
                <PathField
                  label="Catalog Folder"
                  hint="-a  Folder containing catalog files"
                  value={form.catalogFolder}
                  onChange={(v) => set('catalogFolder', v)}
                  onPick={() => handlePickFolder('catalogFolder')}
                  icon={<FolderOpen size={15} />}
                />
              </div>
            )}
          </div>

          {/* Preview command */}
          {form.setupFolder && form.sourceFile && form.outputFolder && (
            <div className="bg-gray-50 border rounded p-3">
              <p className="text-xs text-gray-400 mb-1 font-medium">Command preview</p>
              <code className="text-xs text-gray-700 font-mono break-all">
                IntuneWinAppUtil.exe
                {' -c "'}
                {form.setupFolder}
                {'" -s "'}
                {form.sourceFile}
                {'" -o "'}
                {form.outputFolder}
                {'" -q'}
                {form.addCatalog && form.catalogFolder ? ` -a "${form.catalogFolder}"` : ''}
              </code>
            </div>
          )}

          <button
            onClick={handleBuild}
            disabled={building || !form.setupFolder || !form.sourceFile || !form.outputFolder}
            className="btn-primary"
          >
            <Play size={16} />
            {building ? 'Building...' : 'Build .intunewin'}
          </button>
        </div>
      )}

      {/* Build output terminal */}
      {buildMsgs.length > 0 && (
        <div className="bg-white rounded-lg shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Output</h2>
            {buildDone && (
              <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                <CheckCircle size={14} /> Done
              </span>
            )}
          </div>
          <div
            ref={buildTermRef}
            className="bg-gray-900 rounded p-3 max-h-80 overflow-auto font-mono text-xs space-y-0.5"
          >
            {buildMsgs.map((m, i) => (
              <div
                key={i}
                className={
                  m.stream === 'stderr'
                    ? 'text-red-400'
                    : m.stream === 'system'
                    ? 'text-blue-300'
                    : 'text-green-300'
                }
              >
                {m.text || '\u00A0'}
              </div>
            ))}
            {building && <div className="text-gray-400 animate-pulse">...</div>}
          </div>
        </div>
      )}
      {/* Output folder clear confirmation modal */}
      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-gray-800">Output folder is not empty</p>
                <p className="text-sm text-gray-500 mt-1">
                  The output folder contains {confirmClear.count} item{confirmClear.count !== 1 ? 's' : ''}.
                  IntuneWinAppUtil.exe requires an empty output folder when running non-interactively.
                  Delete the existing contents and continue?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => handleConfirmClear(false)}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmClear(true)}
                className="btn-primary text-sm"
              >
                Delete &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PathField({ label, hint, value, onChange, onPick, pickLabel = 'Browse', icon, placeholder = '' }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {hint && <span className="text-xs text-gray-400 ml-2">{hint}</span>}
      <div className="flex gap-2 mt-1">
        <div className="relative flex-1">
          {icon && (
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
              {icon}
            </span>
          )}
          <input
            className={`input w-full ${icon ? 'pl-7' : ''}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder || 'Type a path or click Browse...'}
          />
        </div>
        {onPick && (
          <button
            type="button"
            onClick={onPick}
            className="btn-secondary text-sm flex-shrink-0"
          >
            {pickLabel}
          </button>
        )}
      </div>
    </label>
  );
}
