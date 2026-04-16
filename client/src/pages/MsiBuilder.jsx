import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle, ChevronDown, ChevronRight,
  FileText, Folder, FolderPlus, Plus, Trash2, Package,
} from 'lucide-react';
import { detectMsiTools, buildMsi } from '../api';

// ─── Tree helpers ─────────────────────────────────────────────────────────────

function treeAdd(root, parentId, newNodes) {
  if (root.id === parentId) return { ...root, children: [...(root.children || []), ...newNodes] };
  return { ...root, children: (root.children || []).map(c => treeAdd(c, parentId, newNodes)) };
}

function treeRemove(root, id) {
  return {
    ...root,
    children: (root.children || []).filter(c => c.id !== id).map(c => treeRemove(c, id)),
  };
}

function flattenAllFiles(node) {
  if (node.type === 'file') return [node];
  return (node.children || []).flatMap(flattenAllFiles);
}

function collectFilesForUpload(node) {
  if (node.type === 'file' && node.file) return [{ id: node.id, file: node.file }];
  return (node.children || []).flatMap(collectFilesForUpload);
}

function serializeTree(node) {
  const { file: _drop, ...rest } = node;
  return { ...rest, fileRef: node.type === 'file' ? node.id : undefined, children: (node.children || []).map(serializeTree) };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

// ─── REG file parser ──────────────────────────────────────────────────────────

function parseRegFile(text) {
  const ROOT_MAP = {
    HKEY_LOCAL_MACHINE: 'HKLM', HKEY_CURRENT_USER: 'HKCU',
    HKEY_CLASSES_ROOT: 'HKCR', HKEY_USERS: 'HKU', HKEY_CURRENT_CONFIG: 'HKCC',
  };

  // Normalise + join continuation lines
  const content = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\\\n\s*/g, '');
  const entries = [];
  let current = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    if (/^(Windows Registry Editor|REGEDIT4)/i.test(line)) continue;

    if (line.startsWith('[')) {
      if (current) entries.push(current);
      if (line.startsWith('[-')) { current = null; continue; } // delete marker
      const fullKey = line.slice(1, -1);
      const sep = fullKey.indexOf('\\');
      const rootFull = sep > -1 ? fullKey.slice(0, sep) : fullKey;
      const key = sep > -1 ? fullKey.slice(sep + 1) : '';
      current = { id: crypto.randomUUID(), root: ROOT_MAP[rootFull] || 'HKLM', key, values: [] };
      continue;
    }

    if (!current) continue;

    let name = '', rest = '';
    if (line.startsWith('@=')) { name = ''; rest = line.slice(2); }
    else if (line.startsWith('"')) {
      const nameEnd = line.indexOf('"', 1);
      if (nameEnd === -1) continue;
      name = line.slice(1, nameEnd);
      const eq = line.indexOf('=', nameEnd + 1);
      if (eq === -1) continue;
      rest = line.slice(eq + 1);
    } else continue;

    if (rest === '-') continue; // value deletion

    let type = 'string', value = '';
    if (rest.startsWith('"')) {
      value = rest.slice(1, rest.lastIndexOf('"')).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      type = 'string';
    } else if (rest.startsWith('dword:')) {
      type = 'integer'; value = String(parseInt(rest.slice(6), 16));
    } else if (rest.startsWith('hex(2):')) {
      type = 'expandable';
      try {
        const bytes = rest.slice(7).split(',').filter(Boolean).map(b => parseInt(b, 16));
        value = new TextDecoder('utf-16le').decode(new Uint8Array(bytes)).replace(/\0/g, '');
      } catch { value = ''; }
    } else if (rest.startsWith('hex(7):')) {
      type = 'multiString';
      try {
        const bytes = rest.slice(7).split(',').filter(Boolean).map(b => parseInt(b, 16));
        value = new TextDecoder('utf-16le').decode(new Uint8Array(bytes)).replace(/\0\0$/, '').replace(/\0/g, '\n');
      } catch { value = ''; }
    } else if (rest.startsWith('hex:')) {
      type = 'binary'; value = rest.slice(4);
    } else continue;

    current.values.push({ name, type, value });
  }
  if (current) entries.push(current);
  return entries;
}

// ─── TreeNode component ───────────────────────────────────────────────────────

function TreeNode({ node, onAddFolder, onAddFiles, onDelete }) {
  const [expanded, setExpanded] = useState(true);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const dragCount = useRef(0);
  const isRoot = node.id === 'ROOT';
  const isDir = node.type === 'dir';

  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; };
  const handleDragEnter = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCount.current++;
    setDragOver(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCount.current = Math.max(0, dragCount.current - 1);
    if (dragCount.current === 0) setDragOver(false);
  };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCount.current = 0; setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.size > 0);
    if (files.length) onAddFiles(node.id, files);
  };

  const confirmAddFolder = () => {
    const name = newFolderName.trim();
    if (name) onAddFolder(node.id, name);
    setAddingFolder(false); setNewFolderName('');
  };

  return (
    <div>
      {/* Row */}
      <div
        className={`flex items-center gap-1.5 py-0.5 px-2 rounded group select-none
          ${isDir ? 'cursor-pointer' : ''}
          ${dragOver ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-gray-100'}`}
        onDragOver={isDir ? handleDragOver : undefined}
        onDragEnter={isDir ? handleDragEnter : undefined}
        onDragLeave={isDir ? handleDragLeave : undefined}
        onDrop={isDir ? handleDrop : undefined}
        onClick={isDir ? () => setExpanded(v => !v) : undefined}
      >
        <span className="w-3.5 flex-shrink-0 text-gray-400">
          {isDir ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
        </span>
        {isDir
          ? <Folder size={14} className="flex-shrink-0 text-yellow-500" />
          : <FileText size={14} className="flex-shrink-0 text-gray-400" />}
        <span className={`text-sm flex-1 truncate ${isRoot ? 'font-semibold text-gray-800' : 'text-gray-700'}`}>
          {node.name}
        </span>
        {node.type === 'file' && (
          <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(node.size)}</span>
        )}
        {/* Action buttons — shown on hover */}
        <div className="hidden group-hover:flex items-center gap-0.5 ml-1" onClick={e => e.stopPropagation()}>
          {isDir && (
            <button
              onClick={() => { setAddingFolder(true); setExpanded(true); }}
              className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700"
              title="Add subfolder"
            >
              <FolderPlus size={12} />
            </button>
          )}
          {!isRoot && (
            <button
              onClick={() => onDelete(node.id)}
              className="p-0.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Children */}
      {isDir && expanded && (
        <div className="ml-4 border-l border-gray-200 pl-1 mt-0.5">
          {(node.children || []).map(child => (
            <TreeNode key={child.id} node={child} onAddFolder={onAddFolder} onAddFiles={onAddFiles} onDelete={onDelete} />
          ))}

          {/* Inline "add folder" input */}
          {addingFolder && (
            <div className="flex items-center gap-1 py-0.5 px-2" onClick={e => e.stopPropagation()}>
              <FolderPlus size={13} className="text-yellow-500 flex-shrink-0" />
              <input
                autoFocus
                className="text-sm border border-blue-400 rounded px-1 w-36 outline-none"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmAddFolder();
                  if (e.key === 'Escape') { setAddingFolder(false); setNewFolderName(''); }
                }}
                placeholder="Folder name…"
              />
              <button onClick={confirmAddFolder} className="text-xs text-blue-600 hover:text-blue-800 px-1">Add</button>
              <button onClick={() => { setAddingFolder(false); setNewFolderName(''); }} className="text-xs text-gray-400 hover:text-gray-700">✕</button>
            </div>
          )}

          {(node.children || []).length === 0 && !addingFolder && (
            <p className="text-xs text-gray-400 italic px-2 py-1">Drop files here from Explorer</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const EMPTY_DETAILS = {
  productName: '', manufacturer: '', version: '1.0.0',
  upgradeCode: '', installDirName: '', platform: 'x64', scope: 'perMachine',
};

const ROOT_NODE = { id: 'ROOT', name: 'INSTALLDIR', type: 'dir', children: [] };

export default function MsiBuilder() {
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [fileTree, setFileTree] = useState(ROOT_NODE);
  const [shortcuts, setShortcuts] = useState([]);
  const [registryEntries, setRegistryEntries] = useState([]);
  const [activeTab, setActiveTab] = useState('files');
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState('');
  const [buildSuccess, setBuildSuccess] = useState(false);
  const [wixTool, setWixTool] = useState(null);
  const [wixChecked, setWixChecked] = useState(false);
  const [regDragOver, setRegDragOver] = useState(false);
  const regFileRef = useRef();
  const regDragCount = useRef(0);

  useEffect(() => {
    detectMsiTools()
      .then(r => setWixTool(r))
      .catch(() => setWixTool({ type: null }))
      .finally(() => setWixChecked(true));
  }, []);

  const det = (field, value) => setDetails(d => ({ ...d, [field]: value }));
  const allFiles = flattenAllFiles(fileTree);

  // ── Tree actions ──
  const handleAddFolder = (parentId, name) =>
    setFileTree(t => treeAdd(t, parentId, [{ id: crypto.randomUUID(), name, type: 'dir', children: [] }]));

  const handleAddFiles = (parentId, files) =>
    setFileTree(t => treeAdd(t, parentId, files.map(f => ({
      id: crypto.randomUUID(), name: f.name, type: 'file', file: f, size: f.size,
    }))));

  const handleDelete = (id) => setFileTree(t => treeRemove(t, id));

  // ── Shortcuts ──
  const addShortcut = () =>
    setShortcuts(s => [...s, { id: crypto.randomUUID(), name: '', targetFileId: '', location: 'both', description: '' }]);
  const updateShortcut = (id, field, value) =>
    setShortcuts(s => s.map(sc => sc.id === id ? { ...sc, [field]: value } : sc));
  const deleteShortcut = (id) => setShortcuts(s => s.filter(sc => sc.id !== id));

  // ── Registry ──
  const importRegEntries = (entries) => setRegistryEntries(prev => [...prev, ...entries]);
  const deleteRegEntry = (id) => setRegistryEntries(prev => prev.filter(e => e.id !== id));

  const handleRegFilePicker = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      const text = await f.text();
      importRegEntries(parseRegFile(text));
    }
    e.target.value = '';
  };

  const handleRegDragOver = (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; };
  const handleRegDragEnter = (e) => {
    e.preventDefault(); e.stopPropagation();
    regDragCount.current++;
    setRegDragOver(true);
  };
  const handleRegDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    regDragCount.current = Math.max(0, regDragCount.current - 1);
    if (regDragCount.current === 0) setRegDragOver(false);
  };
  const handleRegDrop = async (e) => {
    e.preventDefault(); e.stopPropagation();
    regDragCount.current = 0; setRegDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.reg'));
    for (const f of files) {
      const text = await f.text();
      importRegEntries(parseRegFile(text));
    }
  };

  // ── Build ──
  const handleBuild = async () => {
    setBuildError(''); setBuildSuccess(false); setBuilding(true);
    try {
      const uploadFiles = collectFilesForUpload(fileTree);
      const meta = {
        ...details,
        fileTree: serializeTree(fileTree),
        shortcuts,
        registryEntries,
      };
      const formData = new FormData();
      formData.append('meta', JSON.stringify(meta));
      formData.append('fileRefs', JSON.stringify(uploadFiles.map(f => f.id)));
      for (const { file } of uploadFiles) formData.append('files', file);

      const res = await buildMsi(formData);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Build failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${details.productName || 'package'}_${details.version}.msi`,
      });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBuildSuccess(true);
    } catch (err) {
      setBuildError(err.message);
    } finally {
      setBuilding(false);
    }
  };

  const exeFiles = allFiles.filter(f => f.name.toLowerCase().endsWith('.exe'));

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Package size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold">MSI Builder</h1>
      </div>

      {/* WiX tool status banner */}
      {wixChecked && (
        <div className={`flex items-start gap-3 p-3 rounded-lg mb-5 text-sm ${wixTool?.type ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-yellow-50 text-yellow-800 border border-yellow-200'}`}>
          {wixTool?.type
            ? <CheckCircle size={16} className="mt-0.5 flex-shrink-0 text-green-600" />
            : <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-yellow-600" />}
          <div>
            {wixTool?.type
              ? <span><strong>WiX {wixTool.type === 'v5' ? 'v5' : 'v3'}</strong> detected — {wixTool.version}</span>
              : <>
                  <strong>No WiX toolset found.</strong> Install one to compile MSIs:
                  <ul className="mt-1 ml-4 list-disc space-y-0.5">
                    <li><code className="bg-yellow-100 px-1 rounded">dotnet tool install --global wix</code> — WiX v5 (recommended)</li>
                    <li>WiX Toolset v3 from <strong>wixtoolset.org/releases</strong></li>
                  </ul>
                </>}
          </div>
        </div>
      )}

      {/* Package details */}
      <div className="bg-white rounded-lg shadow p-5 mb-5">
        <h2 className="font-semibold text-gray-800 mb-4">Package Details</h2>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Product Name <span className="text-red-500">*</span></span>
            <input className="input mt-1 w-full" value={details.productName} onChange={e => det('productName', e.target.value)} placeholder="My Application" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Manufacturer</span>
            <input className="input mt-1 w-full" value={details.manufacturer} onChange={e => det('manufacturer', e.target.value)} placeholder="My Company" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Version <span className="text-red-500">*</span></span>
            <input className="input mt-1 w-full" value={details.version} onChange={e => det('version', e.target.value)} placeholder="1.0.0" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Upgrade Code (GUID) <span className="text-red-500">*</span></span>
            <div className="flex gap-2 mt-1">
              <input className="input flex-1 font-mono text-xs" value={details.upgradeCode} onChange={e => det('upgradeCode', e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              <button className="btn-secondary text-xs whitespace-nowrap" onClick={() => det('upgradeCode', crypto.randomUUID().toUpperCase())}>Generate</button>
            </div>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Install Folder Name</span>
            <input className="input mt-1 w-full" value={details.installDirName} onChange={e => det('installDirName', e.target.value)} placeholder="Defaults to Product Name" />
          </label>
          <div className="flex gap-6">
            <div>
              <span className="text-sm font-medium text-gray-700 block mb-1">Platform</span>
              {['x64', 'x86'].map(p => (
                <label key={p} className="inline-flex items-center gap-1.5 mr-4 cursor-pointer">
                  <input type="radio" name="platform" value={p} checked={details.platform === p} onChange={() => det('platform', p)} />
                  <span className="text-sm">{p}</span>
                </label>
              ))}
            </div>
            <div>
              <span className="text-sm font-medium text-gray-700 block mb-1">Scope</span>
              <label className="inline-flex items-center gap-1.5 mr-4 cursor-pointer">
                <input type="radio" name="scope" checked={details.scope === 'perMachine'} onChange={() => det('scope', 'perMachine')} />
                <span className="text-sm">All Users</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="scope" checked={details.scope === 'perUser'} onChange={() => det('scope', 'perUser')} />
                <span className="text-sm">Current User</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow mb-5">
        <div className="flex border-b px-4">
          {['files', 'shortcuts', 'registry'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`text-sm font-medium py-3 px-4 border-b-2 -mb-px capitalize ${activeTab === tab ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {tab}
              {tab === 'shortcuts' && shortcuts.length > 0 && <span className="ml-1.5 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">{shortcuts.length}</span>}
              {tab === 'registry' && registryEntries.length > 0 && <span className="ml-1.5 bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">{registryEntries.length}</span>}
            </button>
          ))}
        </div>

        <div className="p-5">
          {/* ── Files tab ── */}
          {activeTab === 'files' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-500">Drag files from Windows Explorer onto any folder node. Use <kbd className="bg-gray-100 px-1 rounded text-xs">+</kbd> to add subfolders.</p>
                <button className="btn-secondary text-sm" onClick={() => handleAddFolder('ROOT', 'New Folder')}>
                  <FolderPlus size={14} /> Add Folder
                </button>
              </div>
              <div className="border rounded-lg p-2 min-h-48 font-mono text-sm bg-gray-50">
                <TreeNode node={fileTree} onAddFolder={handleAddFolder} onAddFiles={handleAddFiles} onDelete={handleDelete} />
              </div>
              {allFiles.length > 0 && (
                <p className="text-xs text-gray-400 mt-2">{allFiles.length} file{allFiles.length !== 1 ? 's' : ''} — {formatBytes(allFiles.reduce((s, f) => s + (f.size || 0), 0))} total</p>
              )}
            </div>
          )}

          {/* ── Shortcuts tab ── */}
          {activeTab === 'shortcuts' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-500">Create shortcuts on the Desktop and/or Start Menu.</p>
                <button className="btn-secondary text-sm" onClick={addShortcut}>
                  <Plus size={14} /> Add Shortcut
                </button>
              </div>
              {shortcuts.length === 0 && (
                <p className="text-gray-400 text-sm py-6 text-center">No shortcuts defined.</p>
              )}
              <div className="space-y-3">
                {shortcuts.map(sc => (
                  <div key={sc.id} className="border rounded-lg p-3 bg-gray-50">
                    <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
                      <label className="block">
                        <span className="text-xs font-medium text-gray-600">Shortcut Name</span>
                        <input className="input mt-1 w-full text-sm" value={sc.name} onChange={e => updateShortcut(sc.id, 'name', e.target.value)} placeholder="My App" />
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-gray-600">Target Executable</span>
                        <select className="input mt-1 w-full text-sm" value={sc.targetFileId} onChange={e => updateShortcut(sc.id, 'targetFileId', e.target.value)}>
                          <option value="">Select .exe…</option>
                          {exeFiles.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          {allFiles.filter(f => !f.name.toLowerCase().endsWith('.exe')).map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-medium text-gray-600">Location</span>
                        <select className="input mt-1 text-sm" value={sc.location} onChange={e => updateShortcut(sc.id, 'location', e.target.value)}>
                          <option value="both">Desktop + Start Menu</option>
                          <option value="desktop">Desktop only</option>
                          <option value="startmenu">Start Menu only</option>
                        </select>
                      </label>
                      <button onClick={() => deleteShortcut(sc.id)} className="text-red-400 hover:text-red-600 mb-0.5">
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <label className="block mt-2">
                      <span className="text-xs font-medium text-gray-600">Description (tooltip)</span>
                      <input className="input mt-1 w-full text-sm" value={sc.description} onChange={e => updateShortcut(sc.id, 'description', e.target.value)} placeholder="Optional" />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Registry tab ── */}
          {activeTab === 'registry' && (
            <div>
              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 transition-colors cursor-pointer
                  ${regDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}
                onDragOver={handleRegDragOver}
                onDragEnter={handleRegDragEnter}
                onDragLeave={handleRegDragLeave}
                onDrop={handleRegDrop}
                onClick={() => regFileRef.current?.click()}
              >
                <input ref={regFileRef} type="file" accept=".reg" multiple className="hidden" onChange={handleRegFilePicker} />
                <p className="text-sm text-gray-600 font-medium">Drop <code>.REG</code> files here</p>
                <p className="text-xs text-gray-400 mt-1">or click to browse — values are parsed into WiX registry elements</p>
              </div>

              {registryEntries.length === 0 && (
                <p className="text-gray-400 text-sm text-center py-4">No registry entries imported.</p>
              )}

              {registryEntries.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Hive</th>
                        <th className="px-3 py-2 text-left font-medium">Key</th>
                        <th className="px-3 py-2 text-left font-medium">Values</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y font-mono">
                      {registryEntries.map(entry => (
                        <tr key={entry.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-semibold text-blue-700">{entry.root}</td>
                          <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{entry.key}</td>
                          <td className="px-3 py-2">
                            <div className="space-y-0.5">
                              {entry.values.length === 0
                                ? <span className="text-gray-400 italic">key only</span>
                                : entry.values.slice(0, 3).map((v, i) => (
                                    <div key={i} className="text-gray-600">
                                      <span className="text-gray-500">{v.name || '(Default)'}</span>
                                      <span className="text-gray-400"> = </span>
                                      <span className="text-green-700 truncate inline-block max-w-[160px] align-bottom">{v.value}</span>
                                      <span className="text-gray-400 ml-1">({v.type})</span>
                                    </div>
                                  ))}
                              {entry.values.length > 3 && (
                                <span className="text-gray-400">+{entry.values.length - 3} more</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button onClick={() => deleteRegEntry(entry.id)} className="text-red-400 hover:text-red-600">
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Build section */}
      <div className="bg-white rounded-lg shadow p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800">Compile MSI</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {allFiles.length} file{allFiles.length !== 1 ? 's' : ''} · {shortcuts.length} shortcut{shortcuts.length !== 1 ? 's' : ''} · {registryEntries.length} registry entr{registryEntries.length !== 1 ? 'ies' : 'y'}
            </p>
          </div>
          <button
            onClick={handleBuild}
            disabled={building || !details.productName || !details.version || !details.upgradeCode}
            className="btn-primary"
          >
            {building ? 'Building…' : 'Compile & Download MSI'}
          </button>
        </div>

        {buildSuccess && !buildError && (
          <div className="flex items-center gap-2 mt-4 text-green-700 bg-green-50 border border-green-200 rounded p-3 text-sm">
            <CheckCircle size={15} /> MSI compiled and downloaded successfully.
          </div>
        )}

        {buildError && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-red-700 text-sm font-medium mb-1">
              <AlertCircle size={15} /> Build failed
            </div>
            <pre className="bg-gray-900 text-red-300 text-xs rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap font-mono">{buildError}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
