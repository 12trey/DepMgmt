import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import {
  Upload, Trash2, FileText, Download, RefreshCw, Pencil, GitBranch,
  AlertTriangle, Image, Code2, FolderOpen, PuzzleIcon, Save, X, Copy, Type, ExternalLink,
} from 'lucide-react';
import {
  getPackage, listFiles, uploadFiles, deleteFile, regeneratePackage,
  checkMissingFiles, gitPublish, updatePackage,
  listFolderFiles, uploadFolderFiles, deleteFolderFile,
  readFolderFile, saveFolderFile, folderFileRawUrl,
  getPsadtStatus, trustPsGallery, installPsadtModule, populateToolkit,
  createExtensionStubs, createAssetReadme,
  readEntryScript, saveEntryScript,
  getConfig, copyDefaultFiles, openInVscode,
} from '../api';

// ── Constants ──────────────────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.bmp', '.webp']);
const TEXT_EXTS  = new Set(['.ps1', '.psm1', '.psd1', '.xml', '.json', '.ini', '.txt', '.bat', '.cmd', '.reg', '.yaml', '.yml', '.csv', '.md']);

const V4_TABS = [
  { id: 'files',        label: 'Installer Files',   icon: FileText,   folder: null },
  { id: 'SupportFiles', label: 'Support Files',      icon: FolderOpen, folder: 'SupportFiles' },
  { id: 'Assets',       label: 'Assets',             icon: Image,      folder: 'Assets' },
  { id: 'Strings',      label: 'Strings',            icon: Type,       folder: 'Strings' },
  { id: 'Extensions',   label: 'Extensions',         icon: PuzzleIcon, folder: 'PSAppDeployToolkit.Extensions' },
  { id: 'Toolkit',      label: 'PSAppDeployToolkit', icon: Code2,      folder: 'PSAppDeployToolkit' },
];

function extOf(name) { return name.slice(name.lastIndexOf('.')).toLowerCase(); }

function getLanguage(filename) {
  const ext = extOf(filename);
  const map = {
    '.ps1': 'powershell', '.psm1': 'powershell', '.psd1': 'powershell',
    '.xml': 'xml',
    '.json': 'json',
    '.yaml': 'yaml', '.yml': 'yaml',
    '.ini': 'ini',
    '.bat': 'bat', '.cmd': 'bat',
    '.md': 'markdown',
  };
  return map[ext] || 'plaintext';
}
function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── Text editor modal ──────────────────────────────────────────────────────────

function TextEditorModal({ appName, version, folder, filename, onClose, onSaved, readFn, saveFn, title }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    const doRead = readFn
      ? readFn().then(d => d.content)
      : readFolderFile(appName, version, folder, filename).then(d => d.content);
    doRead
      .then(c => { setContent(c); setLoading(false); })
      .catch(e => { setErr(e.message); setLoading(false); });
  }, []);

  const save = async () => {
    setSaving(true); setErr('');
    try {
      if (saveFn) {
        await saveFn(content);
      } else {
        await saveFolderFile(appName, version, folder, filename, content);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const header = title ?? (folder ? `${folder}/${filename}` : filename);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl flex flex-col w-full max-w-4xl" style={{ height: '80vh' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="font-semibold text-sm font-mono">{header}</span>
          <div className="flex items-center gap-2">
            {err && <span className="text-red-600 text-xs">{err}</span>}
            <button onClick={save} disabled={saving || loading} className="btn-primary text-sm">
              <Save size={14} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={onClose} className="btn-secondary text-sm"><X size={14} /></button>
          </div>
        </div>
        <div className="flex-1 min-h-0 bg-[#1e1e1e] rounded-b-xl overflow-hidden">
          {loading ? (
            <div className="p-4 text-gray-400 text-sm">Loading…</div>
          ) : (
            <Editor
              height="100%"
              language={getLanguage(filename)}
              value={content}
              onChange={val => setContent(val ?? '')}
              theme="vs-dark"
              options={{
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                tabSize: 4,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Folder section ─────────────────────────────────────────────────────────────

function FolderSection({ appName, version, folder, hint, onCopyDefaults, defaultFilesConfigured = true }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');
  const [err, setErr] = useState('');
  const [editTarget, setEditTarget] = useState(null); // { folder, filename }
  const inputRef = useRef();

  const load = useCallback(() => {
    setLoading(true);
    listFolderFiles(appName, version, folder)
      .then(f => { setFiles(f); setLoading(false); })
      .catch(e => { setErr(e.message); setLoading(false); });
  }, [appName, version, folder]);

  useEffect(() => { load(); }, [load]);

  const handleUpload = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    setUploading(true);
    try {
      await uploadFolderFiles(appName, version, folder, selected);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (name) => {
    try {
      await deleteFolderFile(appName, version, folder, name);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const isImg = (name) => IMAGE_EXTS.has(extOf(name));

  return (
    <div className="bg-white rounded-lg shadow p-5">
      {editTarget && (
        <TextEditorModal
          appName={appName} version={version}
          folder={editTarget.folder} filename={editTarget.filename}
          onClose={() => setEditTarget(null)}
          onSaved={load}
        />
      )}

      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold">{folder}</h2>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
        <div className="flex items-center gap-2">
          <>
            <button
              onClick={async () => {
                if (!defaultFilesConfigured || !onCopyDefaults) return;
                setCopying(true); setCopyMsg('');
                try {
                  const r = await onCopyDefaults();
                  const n = Object.values(r.copied || {}).flat().length;
                  setCopyMsg(`Copied ${n} file${n !== 1 ? 's' : ''}`);
                  load();
                } catch (e) { setCopyMsg(`Error: ${e.message}`); }
                finally { setCopying(false); }
              }}
              disabled={copying || !defaultFilesConfigured}
              className="btn-secondary text-sm"
              title={defaultFilesConfigured ? 'Copy files from default files source' : 'Configure a Default Files source path in Settings first'}
            >
              <Copy size={14} /> {copying ? 'Copying…' : 'Copy Defaults'}
            </button>
            {copyMsg && <span className="text-xs text-gray-500">{copyMsg}</span>}
          </>
          <button onClick={() => inputRef.current.click()} disabled={uploading} className="btn-secondary text-sm">
            <Upload size={14} /> {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={handleUpload} />
      </div>

      {err && <div className="text-red-600 text-sm mb-2">{err}</div>}

      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-gray-400 text-sm">No files yet.</p>
      ) : (
        <ul className="divide-y">
          {files.map(f => (
            <li key={f.name} className="py-2 flex items-center gap-3">
              {isImg(f.name) ? (
                <img
                  src={folderFileRawUrl(appName, version, folder, f.name)}
                  alt={f.name}
                  className="w-10 h-10 object-contain rounded border border-gray-200 bg-gray-50 shrink-0"
                />
              ) : (
                <FileText size={16} className="text-gray-400 shrink-0" />
              )}
              <span className="flex-1 text-sm font-mono truncate">{f.name}</span>
              <span className="text-xs text-gray-400 shrink-0">{fmtSize(f.size)}</span>
              {f.editable && (
                <button
                  onClick={() => setEditTarget({ folder, filename: f.name })}
                  className="text-blue-500 hover:text-blue-700 shrink-0" title="Edit"
                >
                  <Pencil size={14} />
                </button>
              )}
              <button onClick={() => handleDelete(f.name)} className="text-red-500 hover:text-red-700 shrink-0" title="Delete">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Assets section ─────────────────────────────────────────────────────────────

function AssetsSection({ appName, version, onCopyDefaults, defaultFilesConfigured }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [files, setFiles] = useState(null); // null = not yet loaded
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listFolderFiles(appName, version, 'Assets')
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [appName, version, refreshKey]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createAssetReadme(appName, version);
      setRefreshKey(k => k + 1);
    } finally {
      setCreating(false);
    }
  };

  const isEmpty = files !== null && files.length === 0;

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
        <strong>Assets</strong> — Custom branding images that override the toolkit's default dialog
        appearance. Leave this folder empty to use the toolkit defaults from{' '}
        <code>PSAppDeployToolkit/Assets/</code>.
        {isEmpty && (
          <span className="ml-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="underline font-medium hover:text-amber-900"
            >
              {creating ? 'Creating…' : 'Create asset guide (README)'}
            </button>
            {' '}to see expected file names and dimensions.
          </span>
        )}
      </div>
      <FolderSection
        key={refreshKey}
        appName={appName} version={version}
        folder="Assets"
        hint="PNG/ICO branding overrides — AppDeployToolkitLogo.png, AppDeployToolkitBanner.png, AppDeployToolkitIcon.ico"
        onCopyDefaults={onCopyDefaults}
        defaultFilesConfigured={defaultFilesConfigured}
      />
    </div>
  );
}

// ── Extensions section ─────────────────────────────────────────────────────────

function ExtensionsSection({ appName, version, onCopyDefaults, defaultFilesConfigured }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [files, setFiles] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listFolderFiles(appName, version, 'PSAppDeployToolkit.Extensions')
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [appName, version, refreshKey]);

  const hasStubs = files !== null && files.some(
    f => f.name === 'PSAppDeployToolkit.Extensions.psd1' || f.name === 'PSAppDeployToolkit.Extensions.psm1'
  );

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createExtensionStubs(appName, version);
      setRefreshKey(k => k + 1);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
        <strong>PSAppDeployToolkit.Extensions</strong> — Custom PowerShell functions placed here are
        automatically imported by the toolkit at runtime. Edit the <code>.psm1</code> to add
        functions and update the <code>.psd1</code> manifest to export them. Do not modify the
        core <code>PSAppDeployToolkit/</code> folder.
        {files !== null && !hasStubs && (
          <span className="ml-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="underline font-medium hover:text-blue-900"
            >
              {creating ? 'Creating…' : 'Create stub files (.psd1 + .psm1)'}
            </button>
            {' '}to get started.
          </span>
        )}
      </div>
      <FolderSection
        key={refreshKey}
        appName={appName} version={version}
        folder="PSAppDeployToolkit.Extensions"
        hint="Module manifest (.psd1) and script module (.psm1) for custom toolkit functions"
        onCopyDefaults={onCopyDefaults}
        defaultFilesConfigured={defaultFilesConfigured}
      />
    </div>
  );
}

// ── Toolkit section ────────────────────────────────────────────────────────────

function ToolkitSection({ appName, version }) {
  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusErr, setStatusErr] = useState('');
  const [trusting, setTrusting] = useState(false);
  const [installLog, setInstallLog] = useState(null); // null = hidden
  const [installing, setInstalling] = useState(false);
  const [populating, setPopulating] = useState(false);
  const [populateMsg, setPopulateMsg] = useState('');
  const [folderKey, setFolderKey] = useState(0);
  const logBottomRef = useRef(null);

  const loadStatus = useCallback(() => {
    setStatusLoading(true); setStatusErr('');
    getPsadtStatus()
      .then(s => { setStatus(s); setStatusLoading(false); })
      .catch(e => { setStatusErr(e.message); setStatusLoading(false); });
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { logBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [installLog]);

  const handleTrust = async () => {
    setTrusting(true); setStatusErr('');
    try { await trustPsGallery(); loadStatus(); }
    catch (e) { setStatusErr(e.message); }
    finally { setTrusting(false); }
  };

  const handleInstall = async () => {
    setInstallLog([]); setInstalling(true); setStatusErr('');
    try {
      await installPsadtModule((event) => {
        setInstallLog(prev => [...(prev || []), event]);
      });
    } catch (e) {
      setStatusErr(e.message);
    } finally {
      setInstalling(false);
      loadStatus();
    }
  };

  const handlePopulate = async () => {
    setPopulating(true); setPopulateMsg(''); setStatusErr('');
    try {
      const result = await populateToolkit(appName, version);
      setPopulateMsg(`Toolkit folder refreshed — ${result.fileCount} items copied from ${result.modulePath}.`);
      setFolderKey(k => k + 1);
    } catch (e) {
      setStatusErr(e.message);
    } finally {
      setPopulating(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-800">
        <strong>PSAppDeployToolkit module</strong> — New packages are populated automatically when
        the module is installed. Use <em>Re-populate Toolkit Folder</em> to refresh the files after
        a module upgrade, or to populate an imported package that is missing its toolkit files.
      </div>

      {/* Module status card */}
      <div className="bg-white rounded-lg shadow p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Module Status</h2>
          <button onClick={loadStatus} disabled={statusLoading} className="btn-secondary text-xs">
            <RefreshCw size={12} className={statusLoading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {statusErr && <div className="text-red-600 text-sm">{statusErr}</div>}

        {statusLoading ? (
          <p className="text-gray-400 text-sm">Checking…</p>
        ) : status && (
          <div className="space-y-3">
            {/* Installation status */}
            <div className="flex items-center justify-between py-2 border-b">
              <div>
                <span className="text-sm font-medium">PSAppDeployToolkit module</span>
                {status.installed && (
                  <span className="ml-2 text-xs text-gray-400">v{status.version}</span>
                )}
              </div>
              {status.installed ? (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Installed</span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Not installed</span>
              )}
            </div>

            {/* PSGallery trust status — only relevant when module is not yet installed */}
            {!status.installed && (
              <div className="flex items-center justify-between py-2 border-b">
                <div>
                  <span className="text-sm font-medium">PSGallery</span>
                  <span className="ml-2 text-xs text-gray-400">
                    {status.galleryAvailable ? 'required to install module' : 'not configured — run Install-Module manually'}
                  </span>
                </div>
                {status.galleryTrusted ? (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Trusted</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Untrusted</span>
                    {status.galleryAvailable && (
                      <button onClick={handleTrust} disabled={trusting} className="btn-secondary text-xs">
                        {trusting ? 'Trusting…' : 'Trust PSGallery'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              {!status.installed && (
                <button
                  onClick={handleInstall}
                  disabled={installing || !status.galleryAvailable}
                  className="btn-primary text-sm"
                  title={!status.galleryTrusted ? 'Trust PSGallery first to avoid confirmation prompts' : ''}
                >
                  {installing ? <><RefreshCw size={14} className="animate-spin" /> Installing…</> : 'Install Module'}
                </button>
              )}
              {status.installed && (
                <button onClick={handlePopulate} disabled={populating} className="btn-secondary text-sm">
                  {populating ? <><RefreshCw size={14} className="animate-spin" /> Copying files…</> : 'Re-populate Toolkit Folder'}
                </button>
              )}
            </div>

            {populateMsg && (
              <div className="bg-green-50 text-green-700 text-xs p-2 rounded">{populateMsg}</div>
            )}
          </div>
        )}
      </div>

      {/* Install log */}
      {installLog !== null && (
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs font-medium text-gray-600 mb-2">Installation output</div>
          <div className="bg-gray-950 rounded p-3 h-48 overflow-y-auto font-mono text-xs">
            {installLog.map((e, i) => (
              <div key={i} className={
                e.type === 'exit' ? (e.ok ? 'text-green-400' : 'text-red-400') :
                e.type === 'stderr' ? 'text-yellow-300' : 'text-gray-200'
              }>
                {e.type === 'exit'
                  ? (e.ok ? '✓ Installation complete.' : `✗ Exit code ${e.code}${e.error ? ': ' + e.error : ''}`)
                  : e.line}
              </div>
            ))}
            <div ref={logBottomRef} />
          </div>
        </div>
      )}

      {/* Current toolkit folder contents */}
      <FolderSection
        key={folderKey}
        appName={appName} version={version}
        folder="PSAppDeployToolkit"
        hint="Contents of this package's PSAppDeployToolkit folder — populated from the installed module above"
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PackageDetail() {
  const { appName, version } = useParams();
  const navigate = useNavigate();
  const [pkg, setPkg] = useState(null);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [missingFiles, setMissingFiles] = useState([]);
  const [publishing, setPublishing] = useState(false);
  const [activeTab, setActiveTab] = useState('files');
  const [editingScript, setEditingScript] = useState(false);
  const [hasDefaultFiles, setHasDefaultFiles] = useState(false);
  const [packagesBasePath, setPackagesBasePath] = useState('');
  const fileInputRef = useRef();

  const load = async () => {
    try {
      const [p, f, m] = await Promise.all([
        getPackage(appName, version),
        listFiles(appName, version),
        checkMissingFiles(appName, version),
      ]);
      setPkg(p);
      setFiles(f);
      setMissingFiles(m.missing || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, [appName, version]);

  useEffect(() => {
    getConfig().then(cfg => {
      setHasDefaultFiles(!!cfg.defaultFiles?.sourcePath);
      setPackagesBasePath(cfg.packages?.basePath || '');
    }).catch(() => {});
  }, []);

  const handleUpload = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    try {
      await uploadFiles(appName, version, selected);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteFile = async (filename) => {
    await deleteFile(appName, version, filename);
    load();
  };

  const handleRegenerate = async () => {
    setMsg('');
    try {
      await regeneratePackage(appName, version);
      setMsg('Scripts regenerated from current templates.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleStatus = async () => {
    const next = pkg.status === 'ready' ? 'draft' : 'ready';
    try {
      const updated = await updatePackage(appName, version, { status: next });
      setPkg(updated);
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePublish = async () => {
    setMsg(''); setError('');
    setPublishing(true);
    try {
      const result = await gitPublish(appName, version);
      setMsg(result.message);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  if (error) return <div className="bg-red-50 text-red-700 p-4 rounded">{error}</div>;
  if (!pkg) return <p>Loading...</p>;

  const isV4 = pkg.psadtVersion === 'v4';
  const tabs = isV4 ? V4_TABS : [V4_TABS[0]];
  const activeTabDef = tabs.find(t => t.id === activeTab) || tabs[0];

  const entryScriptName = isV4 ? 'Invoke-AppDeployToolkit.ps1' : 'Deploy-Application.ps1';

  return (
    <div className="max-w-4xl">
      {editingScript && (
        <TextEditorModal
          filename={entryScriptName}
          title={entryScriptName}
          readFn={() => readEntryScript(appName, version)}
          saveFn={(content) => saveEntryScript(appName, version, content)}
          onClose={() => setEditingScript(false)}
        />
      )}
      {msg && <div className="bg-green-50 text-green-700 p-3 rounded mb-4">{msg}</div>}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">{pkg.appName}</h1>
          <div className="flex items-center gap-2 text-gray-500">
            <span>Version {pkg.version} {pkg.vendor && `by ${pkg.vendor}`}</span>
            <StatusBadge status={pkg.status || 'draft'} onClick={pkg.status !== 'published' ? handleToggleStatus : undefined} />
          </div>
        </div>
        <div className="flex gap-2">
          {packagesBasePath && (
            <button
              onClick={() => openInVscode(`${packagesBasePath}\\${appName}\\${version}`)}
              className="btn-secondary text-xs"
              title="Open package folder in VS Code"
            >
              <ExternalLink size={16} /> VS Code
            </button>
          )}
          <button onClick={() => navigate(`/packages/${appName}/${version}/edit`)} className="btn-secondary text-xs" title="Edit package settings">
            <Pencil size={16} /> Edit
          </button>
          <button onClick={handleRegenerate} className="btn-secondary text-xs" title="Regenerate scripts from current templates">
            <RefreshCw size={16} /> Regenerate Scripts
          </button>
          <button onClick={handlePublish} disabled={publishing} className="btn-secondary text-xs" title="Commit package to Git repository">
            <GitBranch size={16} /> {publishing ? 'Publishing…' : 'Publish to Repo'}
          </button>
          <a href={`/api/packages/${appName}/${version}/download`} className="btn-primary text-xs">
            <Download size={16} /> Download ZIP
          </a>
        </div>
      </div>

      {/* Metadata */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <h2 className="font-semibold mb-3">Package Details</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">PSADT Version</dt>
          <dd>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${isV4 ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
              {isV4 ? 'v4.1.x' : 'v3'}
            </span>
          </dd>
          <dt className="text-gray-500">Architecture</dt><dd>{pkg.architecture || 'x64'}</dd>
          <dt className="text-gray-500">Entry Script</dt>
          <dd className="flex items-center gap-2">
            <span className="font-mono text-xs">{isV4 ? 'Invoke-AppDeployToolkit.ps1' : 'Deploy-Application.ps1'}</span>
            <button
              onClick={() => setEditingScript(true)}
              className="text-blue-500 hover:text-blue-700 flex items-center gap-1 text-xs"
              title="Edit entry script"
            >
              <Pencil size={12} /> Edit
            </button>
          </dd>
          <dt className="text-gray-500">Install Command</dt><dd className="font-mono text-xs">{pkg.installCommand || '—'}</dd>
          <dt className="text-gray-500">Uninstall Command</dt><dd className="font-mono text-xs">{pkg.uninstallCommand || '—'}</dd>
          <dt className="text-gray-500">Detection</dt><dd>{pkg.detection?.type || '—'}</dd>
          <dt className="text-gray-500">Created</dt><dd>{pkg.createdAt ? new Date(pkg.createdAt).toLocaleString() : '—'}</dd>
        </dl>
      </div>

      {/* Missing files warning */}
      {missingFiles.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-amber-800 font-medium mb-2">
            <AlertTriangle size={16} /> Required installer files are missing
          </div>
          <p className="text-sm text-amber-700 mb-2">
            This package was published to the Git repository but the following installer files are not present in the{' '}
            <span className="font-mono">Files/</span> folder. The package cannot be deployed until they are uploaded.
          </p>
          <ul className="text-sm text-amber-800 space-y-1">
            {missingFiles.map(f => (
              <li key={f.name} className="flex items-center gap-3 font-mono">
                <span>{f.name}</span>
                <span className="text-amber-500 font-sans">{(f.size / 1048576).toFixed(1)} MB</span>
                <span className="text-amber-400 font-sans text-xs truncate">{f.sha256}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tab bar */}
      {isV4 && (
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon size={14} /> {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab content */}
      {activeTab === 'files' && (
        <div className="bg-white rounded-lg shadow p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold">Installer Files</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                MSI, EXE, or other installer files — accessed via <span className="font-mono">$dirFiles</span> in scripts
              </p>
            </div>
            <button onClick={() => fileInputRef.current.click()} className="btn-secondary text-sm">
              <Upload size={14} /> Upload Files
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
          </div>
          {files.length === 0 ? (
            <p className="text-gray-500 text-sm">No files uploaded yet.</p>
          ) : (
            <ul className="divide-y">
              {files.map(f => (
                <li key={f} className="py-2 flex justify-between items-center text-sm">
                  <span className="flex items-center gap-2"><FileText size={16} className="text-gray-400" /> {f}</span>
                  <button onClick={() => handleDeleteFile(f)} className="text-red-500 hover:text-red-700"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'SupportFiles' && (
        <FolderSection
          appName={appName} version={version}
          folder="SupportFiles"
          hint="Registry files, config files, helper scripts, license files — accessed via $dirSupportFiles"
          onCopyDefaults={() => copyDefaultFiles(appName, version, 'SupportFiles')}
          defaultFilesConfigured={hasDefaultFiles}
        />
      )}

      {activeTab === 'Assets' && (
        <AssetsSection
          appName={appName} version={version}
          onCopyDefaults={() => copyDefaultFiles(appName, version, 'Assets')}
          defaultFilesConfigured={hasDefaultFiles}
        />
      )}

      {activeTab === 'Strings' && (
        <FolderSection
          appName={appName} version={version}
          folder="Strings"
          hint="Localization string files for the PSADT UI — accessed via $dirStrings"
          onCopyDefaults={() => copyDefaultFiles(appName, version, 'Strings')}
          defaultFilesConfigured={hasDefaultFiles}
        />
      )}

      {activeTab === 'Extensions' && (
        <ExtensionsSection
          appName={appName} version={version}
          onCopyDefaults={() => copyDefaultFiles(appName, version, 'PSAppDeployToolkit.Extensions')}
          defaultFilesConfigured={hasDefaultFiles}
        />
      )}

      {activeTab === 'Toolkit' && (
        <ToolkitSection appName={appName} version={version} />
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function StatusBadge({ status, onClick }) {
  const styles = {
    draft:      'bg-gray-100 text-gray-700',
    ready:      'bg-blue-100 text-blue-700',
    published:  'bg-green-100 text-green-700',
    imported:   'bg-purple-100 text-purple-700',
  };
  const style = styles[status] || styles.draft;
  const title = onClick ? (status === 'ready' ? 'Click to revert to draft' : 'Click to mark as ready') : undefined;
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${style} ${onClick ? 'cursor-pointer hover:opacity-75' : ''}`}
      onClick={onClick}
      title={title}
    >
      {status}
    </span>
  );
}
