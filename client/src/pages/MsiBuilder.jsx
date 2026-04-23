import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle, ChevronDown, ChevronRight,
  FileText, Folder, FolderPlus, Plus, Trash2, Package, HardDrive, Server, Settings, ShieldCheck,
} from 'lucide-react';
import { detectMsiTools, probeMsi, buildMsi } from '../api';

// ─── Constants ────────────────────────────────────────────────────────────────

// scope: 'machine' | 'user' | 'both'
const WIX_DIR_OPTIONS = [
  { id: 'CommonAppDataFolder',  label: 'ProgramData',          desc: 'C:\\ProgramData\\...',                        scope: 'machine' },
  { id: 'WindowsFolder',        label: 'Windows',              desc: 'C:\\Windows\\...',                            scope: 'machine' },
  { id: 'SystemFolder',         label: 'System32',             desc: 'C:\\Windows\\System32\\...',                  scope: 'machine' },
  { id: 'System64Folder',       label: 'System64',             desc: 'C:\\Windows\\SysWOW64\\...',                  scope: 'machine' },
  { id: 'CommonFilesFolder',    label: 'Common Files (x86)',   desc: 'C:\\Program Files (x86)\\Common Files\\...', scope: 'machine' },
  { id: 'CommonFiles64Folder',  label: 'Common Files (x64)',   desc: 'C:\\Program Files\\Common Files\\...',       scope: 'machine' },
  { id: 'FontsFolder',          label: 'Fonts',                desc: 'C:\\Windows\\Fonts',                          scope: 'machine' },
  { id: 'AppDataFolder',        label: 'AppData (Roaming)',    desc: '%APPDATA%\\...',                              scope: 'user' },
  { id: 'LocalAppDataFolder',   label: 'LocalAppData',         desc: '%LOCALAPPDATA%\\...',                         scope: 'user' },
  { id: 'PersonalFolder',       label: 'Documents',            desc: 'My Documents\\...',                           scope: 'user' },
  { id: 'TempFolder',           label: 'Temp',                 desc: '%TEMP%\\...',                                 scope: 'both' },
  { id: 'custom',               label: 'Custom Path…',         desc: 'Specify an absolute path',                   scope: 'both' },
];

const DEFAULT_SERVICE = {
  name: '', displayName: '', description: '',
  startType: 'auto', account: 'LocalSystem', customAccount: '', password: '',
  errorControl: 'normal',
  startOnInstall: true, stopOnUninstall: true, removeOnUninstall: true,
};

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

function treeUpdateNode(root, id, updates) {
  if (root.id === id) return { ...root, ...updates };
  return { ...root, children: (root.children || []).map(c => treeUpdateNode(c, id, updates)) };
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
  return {
    ...rest,
    fileRef: node.type === 'file' ? node.id : undefined,
    children: (node.children || []).map(serializeTree),
  };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

function incrementVersion(v) {
  const parts = String(v || '1.0.0').split('.');
  while (parts.length < 3) parts.push('0');
  parts[parts.length - 1] = String(parseInt(parts[parts.length - 1], 10) + 1);
  return parts.join('.');
}

// ─── Folder drag-drop helpers ─────────────────────────────────────────────────

async function readEntry(entry) {
  if (!entry) return null;
  if (entry.isFile) {
    return new Promise(resolve =>
      entry.file(f => resolve(
        f.size > 0 ? { id: crypto.randomUUID(), name: f.name, type: 'file', file: f, size: f.size } : null
      ))
    );
  }
  if (entry.isDirectory) {
    const children = await readDirEntry(entry);
    return { id: crypto.randomUUID(), name: entry.name, type: 'dir', children };
  }
  return null;
}

async function readDirEntry(dirEntry) {
  return new Promise(resolve => {
    const reader = dirEntry.createReader();
    const all = [];
    function batch() {
      reader.readEntries(entries => {
        if (!entries.length) {
          Promise.all(all.map(readEntry)).then(nodes => resolve(nodes.filter(Boolean)));
        } else {
          all.push(...entries);
          batch();
        }
      });
    }
    batch();
  });
}

async function dropToNodes(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  if (items.length > 0 && typeof items[0]?.webkitGetAsEntry === 'function') {
    const entries = items.map(item => item.webkitGetAsEntry()).filter(Boolean);
    const nodes = await Promise.all(entries.map(readEntry));
    return nodes.filter(Boolean);
  }
  return Array.from(dataTransfer.files)
    .filter(f => f.size > 0)
    .map(f => ({ id: crypto.randomUUID(), name: f.name, type: 'file', file: f, size: f.size }));
}

// ─── REG file parser ──────────────────────────────────────────────────────────

function parseRegFile(text) {
  const ROOT_MAP = {
    HKEY_LOCAL_MACHINE: 'HKLM', HKEY_CURRENT_USER: 'HKCU',
    HKEY_CLASSES_ROOT: 'HKCR', HKEY_USERS: 'HKU', HKEY_CURRENT_CONFIG: 'HKCC',
  };
  const content = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\\\n\s*/g, '');
  const entries = [];
  let current = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    if (/^(Windows Registry Editor|REGEDIT4)/i.test(line)) continue;

    if (line.startsWith('[')) {
      if (current) entries.push(current);
      if (line.startsWith('[-')) { current = null; continue; }
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

    if (rest === '-') continue;

    let type = 'string', value = '';
    if (rest.startsWith('"')) {
      value = rest.slice(1, rest.lastIndexOf('"')).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      type = 'string';
    } else if (rest.startsWith('dword:')) {
      type = 'integer'; value = String(parseInt(rest.slice(6), 16));
    } else if (rest.startsWith('hex(2):')) {
      type = 'expandable';
      try { const b = rest.slice(7).split(',').filter(Boolean).map(x => parseInt(x, 16)); value = new TextDecoder('utf-16le').decode(new Uint8Array(b)).replace(/\0/g, ''); } catch { value = ''; }
    } else if (rest.startsWith('hex(7):')) {
      type = 'multiString';
      try { const b = rest.slice(7).split(',').filter(Boolean).map(x => parseInt(x, 16)); value = new TextDecoder('utf-16le').decode(new Uint8Array(b)).replace(/\0\0$/, '').replace(/\0/g, '\n'); } catch { value = ''; }
    } else if (rest.startsWith('hex:')) {
      type = 'binary'; value = rest.slice(4);
    } else continue;

    current.values.push({ name, type, value });
  }
  if (current) entries.push(current);
  return entries;
}

// ─── ServiceModal ─────────────────────────────────────────────────────────────

function ServiceModal({ file, onSave, onRemove, onClose }) {
  const [svc, setSvc] = useState(() => ({
    ...DEFAULT_SERVICE,
    name: file.name.replace(/\.exe$/i, ''),
    ...(file.service || {}),
  }));
  const upd = (k, v) => setSvc(s => ({ ...s, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-5 border-b">
          <Server size={18} className="text-blue-600 flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900">Windows Service — {file.name}</h3>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-700 flex-shrink-0">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Service Name <span className="text-red-500">*</span></span>
              <input className="input mt-1 w-full" value={svc.name} onChange={e => upd('name', e.target.value)} placeholder="MyService" />
              <p className="text-xs text-gray-400 mt-0.5">Internal Windows service name (no spaces)</p>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Display Name</span>
              <input className="input mt-1 w-full" value={svc.displayName} onChange={e => upd('displayName', e.target.value)} placeholder={svc.name || 'My Service'} />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Description</span>
            <textarea className="input mt-1 w-full h-16 resize-none" value={svc.description} onChange={e => upd('description', e.target.value)} placeholder="Optional description shown in Services.msc" />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Startup Type</span>
              <select className="input mt-1 w-full" value={svc.startType} onChange={e => upd('startType', e.target.value)}>
                <option value="auto">Automatic</option>
                <option value="demand">Manual</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Error Control</span>
              <select className="input mt-1 w-full" value={svc.errorControl} onChange={e => upd('errorControl', e.target.value)}>
                <option value="ignore">Ignore</option>
                <option value="normal">Normal</option>
                <option value="critical">Critical</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Log On As</span>
            <select className="input mt-1 w-full" value={svc.account} onChange={e => upd('account', e.target.value)}>
              <option value="LocalSystem">Local System</option>
              <option value="LocalService">Local Service</option>
              <option value="NetworkService">Network Service</option>
              <option value="custom">Custom Account…</option>
            </select>
          </label>
          {svc.account === 'custom' && (
            <div className="grid grid-cols-2 gap-3 pl-4 border-l-2 border-gray-200">
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Username</span>
                <input className="input mt-1 w-full text-sm" value={svc.customAccount} onChange={e => upd('customAccount', e.target.value)} placeholder="DOMAIN\\user or .\\user" />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Password</span>
                <input type="password" className="input mt-1 w-full text-sm" value={svc.password} onChange={e => upd('password', e.target.value)} />
              </label>
            </div>
          )}
          <div>
            <span className="text-sm font-medium text-gray-700 block mb-2">Service Actions</span>
            <div className="space-y-2 pl-1">
              {[
                ['startOnInstall', 'Start service after install'],
                ['stopOnUninstall', 'Stop service before uninstall'],
                ['removeOnUninstall', 'Remove (unregister) service on uninstall'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={svc[key] !== false} onChange={e => upd(key, e.target.checked)} />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between p-4 border-t bg-gray-50 rounded-b-xl">
          <button
            className="text-sm text-red-500 hover:text-red-700"
            onClick={onRemove}
          >
            Remove Service Config
          </button>
          <div className="flex gap-2">
            <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
            <button className="btn-primary text-sm" onClick={() => onSave(svc)} disabled={!svc.name.trim()}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DestinationDropZone ──────────────────────────────────────────────────────

function DestinationDropZone({ destId, addingFolder, folderName, onFolderNameChange, onFolderConfirm, onFolderCancel, children, onAddNodes }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={`p-2 min-h-10 font-mono text-sm transition-colors
        ${dragOver ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : 'bg-gray-50'}`}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={e => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={async e => {
        e.preventDefault(); setDragOver(false);
        const nodes = await dropToNodes(e.dataTransfer);
        if (nodes.length) onAddNodes(destId, nodes);
      }}
    >
      {addingFolder && (
        <div className="flex items-center gap-1 py-0.5 px-2 mb-1">
          <FolderPlus size={13} className="text-yellow-500 flex-shrink-0" />
          <input
            autoFocus
            className="text-sm border border-blue-400 rounded px-1 w-40 outline-none bg-white"
            value={folderName}
            onChange={e => onFolderNameChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onFolderConfirm();
              if (e.key === 'Escape') onFolderCancel();
            }}
            onBlur={onFolderConfirm}
            placeholder="Folder name…"
          />
          <button onClick={onFolderConfirm} className="text-xs text-blue-600 hover:text-blue-800 px-1">Add</button>
          <button onClick={onFolderCancel} className="text-xs text-gray-400 hover:text-gray-700">✕</button>
        </div>
      )}
      {children}
      {!children && !addingFolder && (
        <p className="text-xs text-gray-400 italic px-2 py-1">Drop files or folders here from Explorer</p>
      )}
    </div>
  );
}

// ─── TreeNode component ───────────────────────────────────────────────────────

function TreeNode({ node, onAddFolder, onAddNodes, onDelete, onRename, onConfigService, isRoot = false }) {
  const [expanded, setExpanded] = useState(true);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const dragCount = useRef(0);
  const isDir = node.type === 'dir';
  const isExe = node.type === 'file' && node.name.toLowerCase().endsWith('.exe');
  const hasService = Boolean(node.service?.name);

  const commitRename = () => {
    setIsRenaming(false);
    const n = editName.trim();
    if (n && n !== node.name) onRename(node.id, n);
    else setEditName(node.name);
  };

  const handleDragOver = e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; };
  const handleDragEnter = e => { e.preventDefault(); e.stopPropagation(); dragCount.current++; setDragOver(true); };
  const handleDragLeave = e => {
    e.preventDefault(); e.stopPropagation();
    dragCount.current = Math.max(0, dragCount.current - 1);
    if (dragCount.current === 0) setDragOver(false);
  };
  const handleDrop = async e => {
    e.preventDefault(); e.stopPropagation();
    dragCount.current = 0; setDragOver(false);
    const nodes = await dropToNodes(e.dataTransfer);
    if (nodes.length) onAddNodes(node.id, nodes);
  };

  const confirmAddFolder = () => {
    const name = newFolderName.trim();
    if (name) onAddFolder(node.id, name);
    setAddingFolder(false); setNewFolderName('');
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-0.5 px-2 rounded group select-none
          ${isDir && !isRenaming ? 'cursor-pointer' : ''}
          ${dragOver ? 'bg-blue-50 ring-1 ring-inset ring-blue-400' : 'hover:bg-gray-100'}`}
        onDragOver={isDir ? handleDragOver : undefined}
        onDragEnter={isDir ? handleDragEnter : undefined}
        onDragLeave={isDir ? handleDragLeave : undefined}
        onDrop={isDir ? handleDrop : undefined}
        onClick={isDir && !isRenaming ? () => setExpanded(v => !v) : undefined}
      >
        <span className="w-3.5 flex-shrink-0 text-gray-400">
          {isDir ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
        </span>
        {isDir
          ? <Folder size={14} className="flex-shrink-0 text-yellow-500" />
          : <FileText size={14} className="flex-shrink-0 text-gray-400" />}

        {/* Label / rename input */}
        {isRenaming ? (
          <input
            autoFocus
            className="text-sm border border-blue-400 rounded px-1 flex-1 outline-none bg-white"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setIsRenaming(false); setEditName(node.name); }
            }}
            onBlur={commitRename}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            className={`text-sm flex-1 truncate ${isRoot ? 'font-semibold text-gray-800' : 'text-gray-700'}`}
            onDoubleClick={isDir && !isRoot ? e => { e.stopPropagation(); setIsRenaming(true); setEditName(node.name); } : undefined}
            title={isDir && !isRoot ? 'Double-click to rename' : undefined}
          >
            {node.name}
          </span>
        )}

        {/* Service badge */}
        {hasService && (
          <span className="flex-shrink-0 flex items-center gap-0.5 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-1 py-0.5 leading-none">
            <Server size={10} /> SVC
          </span>
        )}

        {node.type === 'file' && (
          <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(node.size)}</span>
        )}

        {/* Hover actions */}
        {!isRenaming && (
          <div className="hidden group-hover:flex items-center gap-0.5 ml-1" onClick={e => e.stopPropagation()}>
            {isDir && !isRoot && (
              <button
                onClick={e => { e.stopPropagation(); setIsRenaming(true); setEditName(node.name); }}
                className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700"
                title="Rename"
              >
                <Settings size={11} />
              </button>
            )}
            {isDir && (
              <button
                onClick={e => { e.stopPropagation(); setAddingFolder(true); setExpanded(true); }}
                className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700"
                title="Add subfolder"
              >
                <FolderPlus size={12} />
              </button>
            )}
            {(isExe || hasService) && (
              <button
                onClick={() => onConfigService(node)}
                className={`p-0.5 rounded hover:bg-blue-50 ${hasService ? 'text-blue-500 hover:text-blue-700' : 'text-gray-400 hover:text-gray-700'}`}
                title={hasService ? 'Edit service config' : 'Configure as Windows service'}
              >
                <Server size={12} />
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
        )}
      </div>

      {isDir && expanded && (
        <div className="ml-4 border-l border-gray-200 pl-1 mt-0.5">
          {(node.children || []).map(child => (
            <TreeNode
              key={child.id} node={child}
              onAddFolder={onAddFolder} onAddNodes={onAddNodes}
              onDelete={onDelete} onRename={onRename} onConfigService={onConfigService}
            />
          ))}

          {addingFolder && (
            <div className="flex items-center gap-1 py-0.5 px-2" onClick={e => e.stopPropagation()}>
              <FolderPlus size={13} className="text-yellow-500 flex-shrink-0" />
              <input
                autoFocus
                className="text-sm border border-blue-400 rounded px-1 w-36 outline-none bg-white"
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
            <p className="text-xs text-gray-400 italic px-2 py-1">Drop files or folders here</p>
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

const INSTALL_DIR_DEST = { id: 'ROOT', wixId: 'INSTALLDIR', name: 'Install Directory', customPath: null, type: 'dir', children: [] };

export default function MsiBuilder() {
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [destinations, setDestinations] = useState([INSTALL_DIR_DEST]);
  const [shortcuts, setShortcuts] = useState([]);
  const [registryEntries, setRegistryEntries] = useState([]);
  const [expandedRegIds, setExpandedRegIds] = useState(new Set());
  const [activeTab, setActiveTab] = useState('files');
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState('');
  const [buildSuccess, setBuildSuccess] = useState(false);
  const [wixTool, setWixTool] = useState(null);
  const [wixChecked, setWixChecked] = useState(false);
  const [regDragOver, setRegDragOver] = useState(false);
  const regDragCount = useRef(0);
  const regFileRef = useRef();

  // MSI drag-drop on Package Details
  const [msiDragOver, setMsiDragOver] = useState(false);
  const msiDragCount = useRef(0);
  const [msiProbing, setMsiProbing] = useState(false);
  const [detectedVersion, setDetectedVersion] = useState('');
  const [msiProbError, setMsiProbError] = useState('');

  // Add destination UI
  const [addDestOpen, setAddDestOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customPathInput, setCustomPathInput] = useState('');

  // Per-destination inline folder creation
  const [destAddingFolder, setDestAddingFolder] = useState({});
  const [destFolderName, setDestFolderName] = useState({});

  // Service config modal
  const [serviceEditFile, setServiceEditFile] = useState(null);

  // Code signing (optional)
  const [signingEnabled, setSigningEnabled] = useState(false);
  const [signingMethod, setSigningMethod] = useState('thumbprint'); // 'thumbprint' | 'pfx'
  const [signingThumbprint, setSigningThumbprint] = useState('');
  const [signingPfxFile, setSigningPfxFile] = useState(null);
  const [signingPfxPassword, setSigningPfxPassword] = useState('');
  const [signingTimestamp, setSigningTimestamp] = useState('http://timestamp.digicert.com');
  const pfxInputRef = useRef();

  useEffect(() => {
    detectMsiTools()
      .then(r => setWixTool(r))
      .catch(() => setWixTool({ type: null }))
      .finally(() => setWixChecked(true));
  }, []);

  const det = (field, value) => setDetails(d => ({ ...d, [field]: value }));
  const allFiles = destinations.flatMap(dest => flattenAllFiles(dest));

  // Available location options filtered by scope
  const scopeFilter = details.scope === 'perUser' ? 'user' : 'machine';
  const availableDestOptions = WIX_DIR_OPTIONS.filter(opt => opt.scope === 'both' || opt.scope === scopeFilter);

  // ── Destination actions ──
  const addDestination = (wixId, customPath = null) => {
    const id = crypto.randomUUID();
    const shortId = id.replace(/-/g, '').slice(0, 12);
    const wixIdFinal = customPath ? `CUSTOMDIR_${shortId}` : wixId;
    const name = customPath ? customPath : (WIX_DIR_OPTIONS.find(d => d.id === wixId)?.label || wixId);
    setDestinations(dests => [...dests, { id, wixId: wixIdFinal, name, customPath, type: 'dir', children: [] }]);
  };

  const removeDestination = (id) => setDestinations(dests => dests.filter(d => d.id !== id));

  const confirmCustomPath = () => {
    const p = customPathInput.trim();
    if (p) addDestination('custom', p);
    setShowCustomInput(false); setCustomPathInput('');
  };

  // ── Dest-level inline folder creation ──
  const openDestFolder = (destId) => {
    setDestAddingFolder(v => ({ ...v, [destId]: true }));
    setDestFolderName(v => ({ ...v, [destId]: '' }));
  };

  const commitDestFolder = (destId) => {
    const name = (destFolderName[destId] || '').trim();
    if (name) handleAddFolder(destId, name);
    setDestAddingFolder(v => ({ ...v, [destId]: false }));
    setDestFolderName(v => ({ ...v, [destId]: '' }));
  };

  const cancelDestFolder = (destId) => {
    setDestAddingFolder(v => ({ ...v, [destId]: false }));
    setDestFolderName(v => ({ ...v, [destId]: '' }));
  };

  // ── Tree actions ──
  const handleAddFolder = (parentId, name) =>
    setDestinations(dests => dests.map(dest =>
      treeAdd(dest, parentId, [{ id: crypto.randomUUID(), name, type: 'dir', children: [] }])
    ));

  const handleAddNodes = (parentId, nodes) =>
    setDestinations(dests => dests.map(dest => treeAdd(dest, parentId, nodes)));

  const handleDelete = (id) =>
    setDestinations(dests => dests.map(dest => treeRemove(dest, id)));

  const handleRename = (nodeId, newName) =>
    setDestinations(dests => dests.map(dest => treeUpdateNode(dest, nodeId, { name: newName })));

  // ── Service config ──
  const handleConfigService = (fileNode) => setServiceEditFile(fileNode);

  const handleSaveService = (svc) => {
    if (serviceEditFile) {
      setDestinations(dests => dests.map(dest => treeUpdateNode(dest, serviceEditFile.id, { service: svc })));
      setServiceEditFile(null);
    }
  };

  const handleRemoveService = () => {
    if (serviceEditFile) {
      setDestinations(dests => dests.map(dest => treeUpdateNode(dest, serviceEditFile.id, { service: null })));
      setServiceEditFile(null);
    }
  };

  // ── MSI probe ──
  const handleMsiDrop = async e => {
    e.preventDefault();
    msiDragCount.current = 0; setMsiDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.msi'));
    if (!file) return;
    setMsiProbing(true); setMsiProbError('');
    try {
      const info = await probeMsi(file);
      setDetectedVersion(info.version);
      setDetails(d => ({
        ...d,
        productName: info.productName || d.productName,
        manufacturer: info.manufacturer || d.manufacturer,
        upgradeCode: info.upgradeCode || d.upgradeCode,
        platform: info.platform || d.platform,
        version: incrementVersion(info.version),
      }));
    } catch (err) {
      setMsiProbError('Could not read MSI: ' + err.message);
    } finally {
      setMsiProbing(false);
    }
  };

  // ── Shortcuts ──
  const addShortcut = () =>
    setShortcuts(s => [...s, { id: crypto.randomUUID(), name: '', targetFileId: '', location: 'both', description: '' }]);
  const updateShortcut = (id, field, value) =>
    setShortcuts(s => s.map(sc => sc.id === id ? { ...sc, [field]: value } : sc));
  const deleteShortcut = (id) => setShortcuts(s => s.filter(sc => sc.id !== id));

  // ── Registry ──
  const importRegEntries = entries => setRegistryEntries(prev => [...prev, ...entries]);
  const deleteRegEntry = id => setRegistryEntries(prev => prev.filter(e => e.id !== id));
  const toggleRegExpand = id => setExpandedRegIds(s => {
    const ns = new Set(s);
    ns.has(id) ? ns.delete(id) : ns.add(id);
    return ns;
  });

  const handleRegFilePicker = async e => {
    for (const f of Array.from(e.target.files || [])) {
      importRegEntries(parseRegFile(await f.text()));
    }
    e.target.value = '';
  };

  const handleRegDrop = async e => {
    e.preventDefault(); e.stopPropagation();
    regDragCount.current = 0; setRegDragOver(false);
    for (const f of Array.from(e.dataTransfer.files).filter(f => f.name.toLowerCase().endsWith('.reg'))) {
      importRegEntries(parseRegFile(await f.text()));
    }
  };

  // ── Build ──
  const handleBuild = async () => {
    setBuildError(''); setBuildSuccess(false); setBuilding(true);
    try {
      const uploadFiles = destinations.flatMap(dest => collectFilesForUpload(dest));
      const meta = {
        ...details,
        destinations: destinations.map(serializeTree),
        shortcuts,
        registryEntries,
      };
      const formData = new FormData();
      formData.append('meta', JSON.stringify(meta));
      formData.append('fileRefs', JSON.stringify(uploadFiles.map(f => f.id)));
      for (const { file } of uploadFiles) formData.append('files', file);

      if (signingEnabled) {
        const signingPayload = {
          method: signingMethod,
          timestamp: signingTimestamp.trim() || undefined,
          ...(signingMethod === 'thumbprint'
            ? { thumbprint: signingThumbprint.trim() }
            : { pfxPassword: signingPfxPassword }),
        };
        formData.append('signing', JSON.stringify(signingPayload));
        if (signingMethod === 'pfx' && signingPfxFile) {
          formData.append('pfxFile', signingPfxFile);
        }
      }

      const res = await buildMsi(formData);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Build failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), {
        href: url, download: `${details.productName || 'package'}_${details.version}.msi`,
      });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
      {/* Service config modal */}
      {serviceEditFile && (
        <ServiceModal
          file={serviceEditFile}
          onSave={handleSaveService}
          onRemove={handleRemoveService}
          onClose={() => setServiceEditFile(null)}
        />
      )}

      <div className="flex items-center gap-3 mb-6">
        <Package size={22} className="text-blue-600" />
        <h1 className="text-2xl font-bold">MSI Builder</h1>
      </div>

      {/* WiX status banner */}
      {wixChecked && (
        <div className={`flex items-start gap-3 p-3 rounded-lg mb-5 text-sm ${wixTool?.type ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-blue-50 text-blue-800 border border-blue-200'}`}>
          {wixTool?.type
            ? <CheckCircle size={16} className="mt-0.5 flex-shrink-0 text-green-600" />
            : <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-blue-600" />}
          <span>
            {wixTool?.type
              ? <><strong>WiX v3.14</strong> detected — {wixTool.version}</>
              : <>WiX v3.14 not found — it will be <strong>downloaded automatically</strong> the first time you compile.</>}
          </span>
        </div>
      )}

      {/* Package Details — MSI drop zone */}
      <div
        className={`bg-white rounded-lg shadow p-5 mb-5 relative transition-all ${msiDragOver ? 'ring-2 ring-blue-400' : ''}`}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
        onDragEnter={e => { e.preventDefault(); msiDragCount.current++; setMsiDragOver(true); }}
        onDragLeave={e => {
          e.preventDefault();
          msiDragCount.current = Math.max(0, msiDragCount.current - 1);
          if (msiDragCount.current === 0) setMsiDragOver(false);
        }}
        onDrop={handleMsiDrop}
      >
        {msiDragOver && (
          <div className="absolute inset-0 bg-blue-50/90 rounded-lg z-10 pointer-events-none flex items-center justify-center">
            <div className="flex items-center gap-2 text-blue-600 font-medium text-sm">
              <Package size={18} /> Drop MSI to auto-fill package details
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">Package Details</h2>
          <span className="text-xs text-gray-400 select-none">Drop an existing .msi to auto-fill ↓</span>
        </div>
        {msiProbing && <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2 mb-4">Reading MSI properties…</div>}
        {msiProbError && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2 mb-4">{msiProbError}</div>}
        {detectedVersion && !msiProbing && (
          <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-3 py-2 mb-4 flex items-center gap-2">
            <Package size={13} className="flex-shrink-0" />
            Imported from existing MSI — detected version: <code className="font-mono bg-blue-100 px-1 rounded">{detectedVersion}</code>
            <span className="text-blue-400">→</span>
            new version: <code className="font-mono bg-blue-100 px-1 rounded">{details.version}</code>
          </div>
        )}
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
            <button key={tab} onClick={() => setActiveTab(tab)}
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
                <p className="text-sm text-gray-500">
                  Drop files or folders from Explorer onto any location.
                  {details.scope === 'perUser' && <span className="ml-1 text-amber-600">Current User scope — locations are filtered to user folders.</span>}
                </p>
                <div className="relative flex items-center gap-2">
                  <button className="btn-secondary text-sm" onClick={() => { setAddDestOpen(v => !v); setShowCustomInput(false); }}>
                    <HardDrive size={14} /> Add Location
                  </button>
                  {addDestOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setAddDestOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-20 w-64 overflow-hidden">
                        {availableDestOptions.map(opt => (
                          <button key={opt.id}
                            className="flex flex-col items-start w-full px-3 py-2 hover:bg-gray-50 text-left border-b last:border-0"
                            onClick={() => {
                              setAddDestOpen(false);
                              if (opt.id === 'custom') setShowCustomInput(true);
                              else addDestination(opt.id);
                            }}
                          >
                            <span className="text-sm font-medium text-gray-800">{opt.label}</span>
                            <span className="text-xs text-gray-400">{opt.desc}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {showCustomInput && (
                <div className="flex items-center gap-2 mb-3">
                  <input
                    autoFocus className="input flex-1 text-sm font-mono"
                    placeholder="C:\Windows\Temp\MyApp"
                    value={customPathInput}
                    onChange={e => setCustomPathInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') confirmCustomPath();
                      if (e.key === 'Escape') { setShowCustomInput(false); setCustomPathInput(''); }
                    }}
                  />
                  <button className="btn-primary text-sm px-3" onClick={confirmCustomPath}>Add</button>
                  <button className="btn-secondary text-sm px-3" onClick={() => { setShowCustomInput(false); setCustomPathInput(''); }}>Cancel</button>
                </div>
              )}

              {destinations.map(dest => (
                <div key={dest.id} className="border rounded-lg mb-3 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-gray-100 border-b">
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder size={14} className="flex-shrink-0 text-yellow-500" />
                      <span className="text-sm font-semibold text-gray-700 truncate">{dest.name}</span>
                      {dest.customPath
                        ? <span className="text-xs text-blue-600 font-mono ml-1 truncate">{dest.customPath}</span>
                        : dest.wixId !== 'INSTALLDIR' && (
                            <span className="text-xs text-gray-500 bg-gray-200 px-1.5 rounded flex-shrink-0">{dest.wixId}</span>
                          )
                      }
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                      <button
                        onClick={() => openDestFolder(dest.id)}
                        className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700"
                        title="Add subfolder"
                      >
                        <FolderPlus size={13} />
                      </button>
                      {dest.wixId !== 'INSTALLDIR' && (
                        <button onClick={() => removeDestination(dest.id)} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500" title="Remove location">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  <DestinationDropZone
                    destId={dest.id}
                    onAddNodes={handleAddNodes}
                    addingFolder={!!destAddingFolder[dest.id]}
                    folderName={destFolderName[dest.id] || ''}
                    onFolderNameChange={v => setDestFolderName(prev => ({ ...prev, [dest.id]: v }))}
                    onFolderConfirm={() => commitDestFolder(dest.id)}
                    onFolderCancel={() => cancelDestFolder(dest.id)}
                  >
                    {dest.children.length > 0
                      ? dest.children.map(child => (
                          <TreeNode
                            key={child.id} node={child}
                            onAddFolder={handleAddFolder} onAddNodes={handleAddNodes}
                            onDelete={handleDelete} onRename={handleRename}
                            onConfigService={handleConfigService}
                          />
                        ))
                      : null
                    }
                  </DestinationDropZone>
                </div>
              ))}

              {allFiles.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">
                  {allFiles.length} file{allFiles.length !== 1 ? 's' : ''} across {destinations.length} location{destinations.length !== 1 ? 's' : ''} — {formatBytes(allFiles.reduce((s, f) => s + (f.size || 0), 0))} total
                  {allFiles.some(f => f.service?.name) && (
                    <span className="ml-2 text-blue-500">· {allFiles.filter(f => f.service?.name).length} service{allFiles.filter(f => f.service?.name).length !== 1 ? 's' : ''}</span>
                  )}
                </p>
              )}
            </div>
          )}

          {/* ── Shortcuts tab ── */}
          {activeTab === 'shortcuts' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-500">Create shortcuts on the Desktop and/or Start Menu.</p>
                <button className="btn-secondary text-sm" onClick={addShortcut}><Plus size={14} /> Add Shortcut</button>
              </div>
              {shortcuts.length === 0 && <p className="text-gray-400 text-sm py-6 text-center">No shortcuts defined.</p>}
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
                          <option value="">Select file…</option>
                          {exeFiles.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          {allFiles.filter(f => !f.name.toLowerCase().endsWith('.exe')).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
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
                      <button onClick={() => deleteShortcut(sc.id)} className="text-red-400 hover:text-red-600 mb-0.5"><Trash2 size={16} /></button>
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
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center mb-4 transition-colors cursor-pointer
                  ${regDragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
                onDragEnter={e => { e.preventDefault(); e.stopPropagation(); regDragCount.current++; setRegDragOver(true); }}
                onDragLeave={e => { e.preventDefault(); e.stopPropagation(); regDragCount.current = Math.max(0, regDragCount.current - 1); if (regDragCount.current === 0) setRegDragOver(false); }}
                onDrop={handleRegDrop}
                onClick={() => regFileRef.current?.click()}
              >
                <input ref={regFileRef} type="file" accept=".reg" multiple className="hidden" onChange={handleRegFilePicker} />
                <p className="text-sm text-gray-600 font-medium">Drop <code>.REG</code> files here</p>
                <p className="text-xs text-gray-400 mt-1">or click to browse — values are parsed into WiX registry elements</p>
              </div>

              {registryEntries.length === 0 && <p className="text-gray-400 text-sm text-center py-4">No registry entries imported.</p>}

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
                      {registryEntries.map(entry => {
                        const expanded = expandedRegIds.has(entry.id);
                        const shown = expanded ? entry.values : entry.values.slice(0, 3);
                        return (
                          <tr key={entry.id} className="hover:bg-gray-50 align-top">
                            <td className="px-3 py-2 font-semibold text-blue-700 whitespace-nowrap">{entry.root}</td>
                            <td className="px-3 py-2 text-gray-700 max-w-xs break-all">{entry.key}</td>
                            <td className="px-3 py-2">
                              <div className="space-y-0.5">
                                {entry.values.length === 0
                                  ? <span className="text-gray-400 italic">key only</span>
                                  : shown.map((v, i) => (
                                      <div key={i} className="text-gray-600">
                                        <span className="text-gray-500">{v.name || '(Default)'}</span>
                                        <span className="text-gray-400"> = </span>
                                        <span className="text-green-700 break-all">{v.value}</span>
                                        <span className="text-gray-400 ml-1">({v.type})</span>
                                      </div>
                                    ))
                                }
                              </div>
                              {entry.values.length > 3 && (
                                <button
                                  onClick={() => toggleRegExpand(entry.id)}
                                  className="text-blue-500 hover:text-blue-700 text-xs mt-1"
                                >
                                  {expanded ? '▲ Show less' : `▼ +${entry.values.length - 3} more`}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right align-top">
                              <button onClick={() => deleteRegEntry(entry.id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Code Signing (optional) */}
      <div className="bg-white rounded-lg shadow p-5 mb-5">
        <button
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setSigningEnabled(v => !v)}
        >
          <ShieldCheck size={16} className={signingEnabled ? 'text-blue-600' : 'text-gray-400'} />
          <span className="font-semibold text-gray-800">Code Signing</span>
          <span className="ml-1 text-xs text-gray-400 font-normal">(optional)</span>
          <span className="ml-auto text-xs text-gray-400">{signingEnabled ? '▲ hide' : '▼ expand'}</span>
        </button>

        {signingEnabled && (
          <div className="mt-4 space-y-4">
            {/* Method */}
            <div className="flex gap-6">
              {[['thumbprint', 'Certificate Store (thumbprint)'], ['pfx', 'PFX File']].map(([val, label]) => (
                <label key={val} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="signingMethod"
                    checked={signingMethod === val}
                    onChange={() => setSigningMethod(val)}
                  />
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>

            {/* Thumbprint */}
            {signingMethod === 'thumbprint' && (
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Certificate Thumbprint <span className="text-red-500">*</span></span>
                <input
                  className="input mt-1 w-full font-mono text-xs"
                  placeholder="e.g. a9 09 50 2d d8 2a e4 14 33 e6 f8 38 86 b0 0d 42 77 a3 2a 7b"
                  value={signingThumbprint}
                  onChange={e => setSigningThumbprint(e.target.value)}
                />
                <p className="text-xs text-gray-400 mt-0.5">Paste the thumbprint from certmgr.msc — spaces and colons are ignored.</p>
              </label>
            )}

            {/* PFX */}
            {signingMethod === 'pfx' && (
              <div className="space-y-3">
                <div>
                  <span className="text-sm font-medium text-gray-700 block mb-1">PFX File <span className="text-red-500">*</span></span>
                  <div className="flex items-center gap-2">
                    <input
                      ref={pfxInputRef}
                      type="file"
                      accept=".pfx,.p12"
                      className="hidden"
                      onChange={e => setSigningPfxFile(e.target.files?.[0] || null)}
                    />
                    <button className="btn-secondary text-sm" onClick={() => pfxInputRef.current?.click()}>
                      Browse…
                    </button>
                    {signingPfxFile
                      ? <span className="text-sm text-gray-700">{signingPfxFile.name}</span>
                      : <span className="text-sm text-gray-400">No file selected</span>
                    }
                  </div>
                </div>
                <label className="block">
                  <span className="text-sm font-medium text-gray-700">PFX Password</span>
                  <input
                    type="password"
                    className="input mt-1 w-64"
                    autoComplete="new-password"
                    value={signingPfxPassword}
                    onChange={e => setSigningPfxPassword(e.target.value)}
                    placeholder="Leave blank if no password"
                  />
                </label>
              </div>
            )}

            {/* Timestamp */}
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Timestamp Server</span>
              <input
                className="input mt-1 w-full"
                value={signingTimestamp}
                onChange={e => setSigningTimestamp(e.target.value)}
                placeholder="http://timestamp.digicert.com"
              />
              <p className="text-xs text-gray-400 mt-0.5">Recommended — prevents the signature from expiring with the certificate. Leave blank to skip.</p>
            </label>
          </div>
        )}
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
            disabled={
              building ||
              !details.productName || !details.version || !details.upgradeCode ||
              (signingEnabled && signingMethod === 'thumbprint' && !signingThumbprint.trim()) ||
              (signingEnabled && signingMethod === 'pfx' && !signingPfxFile)
            }
            className="btn-primary"
          >
            {building
              ? (signingEnabled ? 'Building & Signing…' : 'Building…')
              : (signingEnabled ? 'Compile, Sign & Download MSI' : 'Compile & Download MSI')}
          </button>
        </div>

        {buildSuccess && !buildError && (
          <div className="flex items-center gap-2 mt-4 text-green-700 bg-green-50 border border-green-200 rounded p-3 text-sm">
            <CheckCircle size={15} /> MSI compiled{signingEnabled ? ', signed,' : ''} and downloaded successfully.
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
