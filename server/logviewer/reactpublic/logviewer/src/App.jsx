import { useState, useEffect, useCallback, useRef } from 'react';
import { socket } from './socket';
import { findErrorCodesInText } from './utils/errorCodes';
import IntuneTab from './components/IntuneTab';
import DsregTab from './components/DsregTab';
import './App.css';

const ROW_HEIGHT = 22;
const BUFFER = 80;
const DEFAULT_COL_WIDTHS = [90, 90, 140, 70, 65, 65];
const COMMON_CHANNELS = [
  'Application', 'System', 'Setup',
  'Microsoft-Windows-PowerShell/Operational',
  'Microsoft-Windows-GroupPolicy/Operational',
  'Microsoft-Windows-WindowsUpdateClient/Operational',
  'Microsoft-Windows-DeviceManagement-Enterprise-Diagnostics-Provider/Admin',
  'Microsoft-Windows-Bits-Client/Operational',
  'Microsoft-Windows-TaskScheduler/Operational',
  'Microsoft-Windows-Sysmon/Operational',
];

// ── Helpers ────────────────────────────────────────────────────────────────
function calcDelta(prev, curr) {
  try {
    const a = logTime(prev), b = logTime(curr);
    if (!a || !b) return '';
    const ms = b - a;
    if (ms < 0) return '';
    if (ms < 1000) return `+${ms}ms`;
    if (ms < 60000) return `+${(ms / 1000).toFixed(1)}s`;
    return `+${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
  } catch { return ''; }
}

function logTime(e) {
  if (!e?.time) return null;
  try {
    let d = (e.date || '').replace(/^(\d+)-(\d+)-(\d{4})$/, '$3-$1-$2');
    d = d.replace(/-(\d{1})-/, '-0$1-').replace(/-(\d{1})$/, '-0$1');
    const t = (e.time || '').replace(/[+-]\d+$/, '');
    return new Date(d + 'T' + t);
  } catch { return null; }
}

function makeFilter(severityFilter, filterText, filterIsRegex) {
  return (e) => {
    if (severityFilter > 0 && e.type !== severityFilter) return false;
    if (!filterText) return true;
    if (filterIsRegex) {
      try {
        const re = new RegExp(filterText, 'i');
        return re.test(e.message || '') || re.test(e.component || '') || re.test(e.file || '');
      } catch { return false; }
    }
    const low = filterText.toLowerCase();
    return (e.message?.toLowerCase().includes(low)) ||
           (e.component?.toLowerCase().includes(low)) ||
           (e.file?.toLowerCase().includes(low));
  };
}

function makeFindMatcher(findText, findIsRegex) {
  if (!findText) return null;
  if (findIsRegex) {
    try { const re = new RegExp(findText, 'i'); return (s) => re.test(s); }
    catch { return null; }
  }
  const low = findText.toLowerCase();
  return (s) => s && s.toLowerCase().includes(low);
}

export default function App() {
  // ── Tab ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('viewer');

  // ── File browser ─────────────────────────────────────────────────────────
  const [browserData, setBrowserData] = useState({ current: '', parent: null, entries: [], isRoot: false });
  const [selectedFile, setSelectedFile] = useState(null);

  // ── Log state ─────────────────────────────────────────────────────────────
  const [currentFile, setCurrentFile] = useState('No file open');
  const [statusWatching, setStatusWatching] = useState('');
  const [tailPaused, setTailPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [allEntries, setAllEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [detailEntry, setDetailEntry] = useState(null);

  // ── Filter ────────────────────────────────────────────────────────────────
  const [severityFilter, setSeverityFilter] = useState(0);
  const [filterInputValue, setFilterInputValue] = useState('');
  const [filterText, setFilterText] = useState('');
  const [filterIsRegex, setFilterIsRegex] = useState(false);

  // ── Find ──────────────────────────────────────────────────────────────────
  const [showFindBar, setShowFindBar] = useState(false);
  const [findInputValue, setFindInputValue] = useState('');
  const [findText, setFindText] = useState('');
  const [findIsRegex, setFindIsRegex] = useState(false);
  const [findResults, setFindResults] = useState([]);
  const [findIdx, setFindIdx] = useState(-1);

  // ── Virtual scroll ────────────────────────────────────────────────────────
  const [vsRange, setVsRange] = useState({ start: 0, end: 100 });

  // ── Modals ────────────────────────────────────────────────────────────────
  const [rowModal, setRowModal] = useState({ show: false, title: '', fields: [], errorCodes: [] });
  const [channelModal, setChannelModal] = useState({ show: false, channels: null, search: '' });

  // ── Appearance ────────────────────────────────────────────────────────────
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('aicm-font') || '13', 10));
  const [theme, setTheme] = useState(() => localStorage.getItem('aicm-theme') || 'dark');

  // ── Intune toolbar state ──────────────────────────────────────────────────
  const [intuneFileLabel, setIntuneFileLabel] = useState('No file loaded');

  // ── Refs ──────────────────────────────────────────────────────────────────
  const scrollWrapRef    = useRef(null);
  const logHeaderRef     = useRef(null);
  const sidebarRef       = useRef(null);
  const resizerRef       = useRef(null);
  const findInputRef     = useRef(null);
  const filterTimerRef   = useRef(null);
  const findTimerRef     = useRef(null);
  const intuneTabRef     = useRef(null);
  const dsregTabRef      = useRef(null);
  const autoScrollRef    = useRef(true);
  const tailPausedRef    = useRef(false);
  const activeTabRef     = useRef('viewer');
  const filteredEntriesRef = useRef([]);
  const findResultsRef   = useRef([]);
  const findIdxRef       = useRef(-1);
  const colWidthsRef     = useRef(
    (() => { try { return JSON.parse(localStorage.getItem('aicm-cols')) || null; } catch { return null; } })()
    || [...DEFAULT_COL_WIDTHS]
  );

  // ── Keep refs in sync ─────────────────────────────────────────────────────
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);
  useEffect(() => { tailPausedRef.current = tailPaused; }, [tailPaused]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { filteredEntriesRef.current = filteredEntries; }, [filteredEntries]);
  useEffect(() => { findResultsRef.current = findResults; }, [findResults]);
  useEffect(() => { findIdxRef.current = findIdx; }, [findIdx]);

  // ── Appearance effects ────────────────────────────────────────────────────
  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem('aicm-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-size', fontSize + 'px');
    localStorage.setItem('aicm-font', String(fontSize));
  }, [fontSize]);

  // ── Column template ───────────────────────────────────────────────────────
  const applyColTemplate = useCallback(() => {
    const tpl = colWidthsRef.current.map(w => w + 'px').join(' ') + ' 1fr';
    document.documentElement.style.setProperty('--col-template', tpl);
  }, []);

  useEffect(() => { applyColTemplate(); }, [applyColTemplate]);

  // ── Filtering ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fn = makeFilter(severityFilter, filterText, filterIsRegex);
    setFilteredEntries(allEntries.filter(fn));
  }, [severityFilter, filterText, filterIsRegex, allEntries]);

  // ── Virtual scroll reset + auto-scroll when filteredEntries changes ───────
  useEffect(() => {
    filteredEntriesRef.current = filteredEntries;
    const total = filteredEntries.length;
    const wrap = scrollWrapRef.current;
    const viewH = wrap ? (wrap.clientHeight || 400) : 400;
    setVsRange({ start: 0, end: Math.min(total - 1, Math.ceil(viewH / ROW_HEIGHT) + BUFFER) });
    if (autoScrollRef.current && wrap) {
      wrap.scrollTop = wrap.scrollHeight;
    }
  }, [filteredEntries]);

  // ── Find ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const matcher = makeFindMatcher(findText, findIsRegex);
    if (!matcher) { setFindResults([]); setFindIdx(-1); return; }
    const results = [];
    filteredEntries.forEach((e, i) => {
      if (matcher(e.message || '') || matcher(e.component || '')) results.push(i);
    });
    setFindResults(results);
    setFindIdx(results.length ? 0 : -1);
  }, [findText, findIsRegex, filteredEntries]);

  // ── Scroll to find match ──────────────────────────────────────────────────
  useEffect(() => {
    if (findIdx >= 0 && findResults[findIdx] !== undefined) {
      const wrap = scrollWrapRef.current;
      if (wrap) {
        const target = findResults[findIdx] * ROW_HEIGHT - (wrap.clientHeight / 2);
        wrap.scrollTop = Math.max(0, target);
      }
    }
  }, [findIdx, findResults]);

  // ── Focus find input when bar shows ──────────────────────────────────────
  useEffect(() => {
    if (showFindBar && findInputRef.current) findInputRef.current.focus();
  }, [showFindBar]);

  // ── Column resize ─────────────────────────────────────────────────────────
  useEffect(() => {
    const header = logHeaderRef.current;
    if (!header) return;
    let dragging = false, colIdx = -1, startX = 0, startW = 0, activeHandle = null;
    const COL_MIN = 40;

    const onDown = (e) => {
      const h = e.target.closest('.col-rz');
      if (!h) return;
      e.preventDefault();
      dragging = true;
      colIdx = parseInt(h.dataset.col, 10);
      startX = e.clientX;
      startW = colWidthsRef.current[colIdx];
      activeHandle = h;
      h.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      colWidthsRef.current[colIdx] = Math.max(COL_MIN, startW + (e.clientX - startX));
      applyColTemplate();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      if (activeHandle) { activeHandle.classList.remove('active'); activeHandle = null; }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('aicm-cols', JSON.stringify(colWidthsRef.current));
      setVsRange(prev => ({ ...prev })); // force row re-render
    };
    const onDbl = (e) => {
      const h = e.target.closest('.col-rz');
      if (!h) return;
      const i = parseInt(h.dataset.col, 10);
      colWidthsRef.current[i] = DEFAULT_COL_WIDTHS[i];
      applyColTemplate();
      localStorage.setItem('aicm-cols', JSON.stringify(colWidthsRef.current));
      setVsRange(prev => ({ ...prev }));
    };

    header.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    header.addEventListener('dblclick', onDbl);
    return () => {
      header.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      header.removeEventListener('dblclick', onDbl);
    };
  }, [applyColTemplate]);

  // ── Sidebar resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const resizer = resizerRef.current;
    const sidebar = sidebarRef.current;
    if (!resizer || !sidebar) return;
    let drag = false, sx = 0, sw = 0;
    const onDown = (e) => { drag = true; sx = e.clientX; sw = sidebar.offsetWidth; resizer.classList.add('dragging'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; };
    const onMove = (e) => { if (!drag) return; sidebar.style.width = Math.max(150, Math.min(500, sw + e.clientX - sx)) + 'px'; };
    const onUp   = () => { if (!drag) return; drag = false; resizer.classList.remove('dragging'); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    resizer.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      resizer.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── Socket log:lines ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (data) => {
      if (tailPausedRef.current || activeTabRef.current !== 'viewer') return;
      const newE = data.entries || [];
      if (!newE.length) return;
      setAllEntries(prev => [...prev, ...newE]);
    };
    socket.on('log:lines', handler);
    return () => socket.off('log:lines', handler);
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  const prevFind = useCallback(() => {
    const results = findResultsRef.current;
    if (!results.length) return;
    const newIdx = (findIdxRef.current - 1 + results.length) % results.length;
    findIdxRef.current = newIdx;
    setFindIdx(newIdx);
  }, []);

  const nextFind = useCallback(() => {
    const results = findResultsRef.current;
    if (!results.length) return;
    const newIdx = (findIdxRef.current + 1) % results.length;
    findIdxRef.current = newIdx;
    setFindIdx(newIdx);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        if (activeTabRef.current !== 'viewer') return;
        setShowFindBar(v => !v);
      }
      if (e.key === 'F3') {
        e.preventDefault();
        if (e.shiftKey) prevFind(); else nextFind();
      }
      if (e.key === 'Escape') {
        setShowFindBar(false);
        setFindText('');
        setFindInputValue('');
        setRowModal(m => ({ ...m, show: false }));
        setChannelModal(m => ({ ...m, show: false }));
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [prevFind, nextFind]);

  // ── Init: load drives ─────────────────────────────────────────────────────
  const fetchBrowse = useCallback((dirPath) => {
    const url = '/api/browse' + (dirPath ? '?path=' + encodeURIComponent(dirPath) : '');
    return fetch(url).then(r => r.json());
  }, []);

  const handleOpenFolder = useCallback((fullPath) => {
    fetchBrowse(fullPath ?? null).then(data => {
      setBrowserData({
        current: data.current || '',
        parent:  data.parent  ?? null,
        entries: data.entries || [],
        isRoot:  data.isRoot  || false,
      });
    }).catch(() => {
      setBrowserData({ current: '', parent: null, entries: [], isRoot: false });
    });
  }, [fetchBrowse]);

  useEffect(() => { handleOpenFolder(null); }, [handleOpenFolder]);

  // ── Viewer actions ────────────────────────────────────────────────────────
  const resetViewer = useCallback(() => {
    setAllEntries([]);
    setFilteredEntries([]);
    setSelectedIdx(-1);
    setDetailEntry(null);
    setFindText('');
    setFindInputValue('');
    setFindResults([]);
    setFindIdx(-1);
    setVsRange({ start: 0, end: 100 });
  }, []);

  const handleOpenFile = useCallback((filePath) => {
    socket.emit('unwatch');
    setTailPaused(false);
    setSelectedFile(filePath);
    resetViewer();
    setCurrentFile(filePath);
    setActiveTab('viewer');

    const fileName = filePath.split(/[\\/]/).pop();
    const isEvtx = fileName.toLowerCase().endsWith('.evtx');
    const apiUrl = isEvtx
      ? `/api/evtx?path=${encodeURIComponent(filePath)}`
      : `/api/read?path=${encodeURIComponent(filePath)}`;

    document.title = `${fileName} - Log Viewer`;

    fetch(apiUrl)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setAllEntries(data.entries || []);
        if (!isEvtx) {
          socket.emit('watch', { path: filePath });
          setStatusWatching(`🔒 Watching: ${fileName}`);
        } else {
          setStatusWatching(`📄 ${fileName} (snapshot)`);
        }
      })
      .catch(err => {
        setAllEntries([{ type: 3, message: `Error: ${err.message}`, time: '', date: '', component: '', thread: '', typeName: 'Error' }]);
        setStatusWatching('');
      });
  }, [resetViewer]);

  const openChannel = useCallback((channelName) => {
    socket.emit('unwatch');
    setTailPaused(false);
    resetViewer();
    setCurrentFile(channelName);
    setActiveTab('viewer');
    document.title = `${channelName.split('/').pop()} - Log Viewer`;

    fetch(`/api/evtx?channel=${encodeURIComponent(channelName)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        const entries = data.entries || [];
        setAllEntries(entries);
        let since = new Date().toISOString();
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].isoTime) { since = entries[i].isoTime; break; }
        }
        socket.emit('watch:channel', { channel: channelName, since });
        setStatusWatching(`🔒 Live: ${channelName}`);
        setChannelModal(m => ({ ...m, show: false }));
      })
      .catch(err => {
        setAllEntries([{ type: 3, message: `Error: ${err.message}`, time: '', date: '', component: '', thread: '', typeName: 'Error' }]);
      });
  }, [resetViewer]);

  const openAnsibleLog = useCallback(() => {
    socket.emit('unwatch');
    setTailPaused(false);
    resetViewer();
    setCurrentFile('Ansible Playbook Log (live)');
    setActiveTab('viewer');
    setSelectedFile(null);
    document.title = 'Ansible Playbook Log - Log Viewer';
    setStatusWatching('🕴 Live: Ansible Playbook Log');
    socket.emit('watch:ansible');
  }, [resetViewer]);

  const openFromContent = useCallback((content, fileName) => {
    socket.emit('unwatch');
    setTailPaused(false);
    resetViewer();
    setCurrentFile(`${fileName} (local)`);
    setActiveTab('viewer');
    document.title = `${fileName} - Log Viewer`;
    setStatusWatching('');

    fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: content })
      .then(r => r.json())
      .then(data => { if (data.error) throw new Error(data.error); setAllEntries(data.entries || []); })
      .catch(err => {
        setAllEntries([{ type: 3, message: `Error: ${err.message}`, time: '', date: '', component: '', thread: '', typeName: 'Error' }]);
      });
  }, [resetViewer]);

  // ── Scroll handler ────────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const wrap = scrollWrapRef.current;
    if (!wrap) return;
    const total = filteredEntriesRef.current.length;
    if (!total) return;
    const scrollTop = wrap.scrollTop;
    const viewH = wrap.clientHeight || 400;
    const visStart = Math.floor(scrollTop / ROW_HEIGHT);
    const visEnd   = Math.ceil((scrollTop + viewH) / ROW_HEIGHT);
    setVsRange({
      start: Math.max(0, visStart - BUFFER),
      end:   Math.min(total - 1, visEnd + BUFFER),
    });
  }, []);

  // ── Drag & drop on viewer ─────────────────────────────────────────────────
  const [viewerDragOver, setViewerDragOver] = useState(false);
  const onViewerDragOver  = (e) => { e.preventDefault(); setViewerDragOver(true); };
  const onViewerDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setViewerDragOver(false); };
  const onViewerDrop = (e) => {
    e.preventDefault();
    setViewerDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.name.toLowerCase().endsWith('.evtx')) {
      setCurrentFile(file.name);
      setAllEntries([{ type: 2, message: '.evtx files must be opened via the file browser (drag-and-drop reads binary files as text).', time: '', date: '', component: '', thread: '', typeName: 'Warning' }]);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => openFromContent(ev.target.result, file.name);
    reader.readAsText(file);
  };

  // ── Channels modal ────────────────────────────────────────────────────────
  const openChannelsModal = useCallback(() => {
    setChannelModal(m => {
      if (m.channels) return { ...m, show: true, search: '' };
      // need to load
      fetch('/api/evtx/channels')
        .then(r => r.json())
        .then(data => setChannelModal(prev => ({ ...prev, channels: data.channels || [], loading: false })))
        .catch(() => setChannelModal(prev => ({ ...prev, channels: [], loading: false })));
      return { ...m, show: true, search: '', loading: true };
    });
  }, []);

  const filteredChannels = (() => {
    if (!channelModal.channels) return [];
    const low = channelModal.search.toLowerCase();
    const commonSet = new Set(COMMON_CHANNELS.map(c => c.toLowerCase()));
    return channelModal.channels
      .filter(c => !low || c.toLowerCase().includes(low))
      .sort((a, b) => {
        const ac = commonSet.has(a.toLowerCase()) ? 0 : 1;
        const bc = commonSet.has(b.toLowerCase()) ? 0 : 1;
        if (ac !== bc) return ac - bc;
        return a.localeCompare(b);
      });
  })();

  // ── Row detail + modal ────────────────────────────────────────────────────
  const showRowModal = useCallback((entry) => {
    const typeClass = entry.type === 3 ? 'val-error' : entry.type === 2 ? 'val-warning' : 'val-info';
    const isEvtx = entry.format === 'evtx';
    const title  = isEvtx ? 'Event Log Entry' : 'Log Entry Detail';
    const fields = isEvtx ? [
      { label: 'Level',    value: entry.typeName  || 'Information', cls: typeClass },
      { label: 'Date',     value: entry.date      || '' },
      { label: 'Time',     value: entry.time      || '' },
      { label: 'Event ID', value: entry.eventId   || '' },
      { label: 'Channel',  value: entry.channel   || '' },
      { label: 'Source',   value: entry.component || '' },
      { label: 'Computer', value: entry.computer  || '' },
      { label: 'User',     value: entry.user      || '' },
      { label: 'Keywords', value: entry.keywords  || '' },
      { label: 'Task',     value: entry.thread    || '' },
      { label: 'Message',  value: entry.message   || '' },
      { label: 'Raw',      value: entry.raw       || '' },
    ] : [
      { label: 'Type',      value: entry.typeName || 'Info', cls: typeClass },
      { label: 'Time',      value: entry.time      || '' },
      { label: 'Date',      value: entry.date      || '' },
      { label: 'Component', value: entry.component || '' },
      { label: 'Thread',    value: entry.thread    || '' },
      { label: 'File',      value: entry.file      || '' },
      { label: 'Format',    value: entry.format    || '' },
      { label: 'Message',   value: entry.message   || '' },
      { label: 'Raw',       value: entry.raw       || '' },
    ];
    const errorCodes = findErrorCodesInText(entry.message || '');
    setRowModal({ show: true, title, fields, errorCodes });
  }, []);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const handleExportCsv = useCallback(() => {
    const fe = filteredEntriesRef.current;
    if (!fe.length) return;
    const rows = ['Time,Date,Component,Thread,Delta,Type,Message'];
    fe.forEach((e, i) => {
      const delta = i > 0 ? calcDelta(fe[i - 1], e) : '';
      rows.push([e.time||'', e.date||'', e.component||'', e.thread||'', delta, e.typeName||'Info', e.message||'']
        .map(v => { const s = String(v).replace(/"/g, '""'); return /[,"\n]/.test(s) ? `"${s}"` : s; })
        .join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (currentFile !== 'No file open' ? currentFile.split(/[\\/]/).pop() : 'log') + '-export.csv';
    a.click();
  }, [currentFile]);

  // ── Filter debounce ───────────────────────────────────────────────────────
  const handleFilterChange = useCallback((e) => {
    const v = e.target.value;
    setFilterInputValue(v);
    clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(() => setFilterText(v.trim()), 150);
  }, []);

  // ── Find debounce ─────────────────────────────────────────────────────────
  const handleFindChange = useCallback((e) => {
    const v = e.target.value;
    setFindInputValue(v);
    clearTimeout(findTimerRef.current);
    findTimerRef.current = setTimeout(() => setFindText(v.trim()), 150);
  }, []);

  // ── Status bar values ─────────────────────────────────────────────────────
  const statusEntries  = `${allEntries.length} entries`;
  const statusFiltered = filteredEntries.length !== allEntries.length ? `${filteredEntries.length} shown` : '';
  const errs  = allEntries.filter(e => e.type === 3).length;
  const warns = allEntries.filter(e => e.type === 2).length;
  const statusErrors = (errs || warns) ? `${errs} errors  ${warns} warnings` : '';

  // ── Detail panel content ──────────────────────────────────────────────────
  const detailContent = (() => {
    if (!detailEntry) return null;
    const codes = findErrorCodesInText(detailEntry.message || '');
    return (
      <>
        <strong>Raw:</strong> {detailEntry.raw || detailEntry.message || ''}
        {codes.length > 0 && (
          <>
            {'\n\n'}<strong>Error Codes:</strong>{'\n'}
            {codes.map((c, i) => <span key={i}>{'  '}{c.code}{'  →  '}{c.description}{'\n'}</span>)}
          </>
        )}
      </>
    );
  })();

  // ── Rendered log rows (virtual scroll) ────────────────────────────────────
  const { start: vsStart, end: vsEnd } = vsRange;
  const totalRows = filteredEntries.length;
  const rowsToRender = filteredEntries.slice(vsStart, vsEnd + 1);
  const findResultSet = new Set(findResults);

  return (
    <div className="mainSection">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div id="topbar">
        <div id="tab-bar">
          <span className="brand">&#128196; Log Viewer</span>
          <button className={`tab-btn${activeTab === 'viewer' ? ' active' : ''}`} onClick={() => setActiveTab('viewer')}>&#128196; Log Viewer</button>
          <button className={`tab-btn${activeTab === 'intune' ? ' active' : ''}`} onClick={() => setActiveTab('intune')}>&#128295; Intune Diagnostics</button>
          <button className={`tab-btn${activeTab === 'dsreg'  ? ' active' : ''}`} onClick={() => setActiveTab('dsreg')}>&#128187; DSRegCmd</button>
        </div>

        <div id="toolbar">
          {/* Log Viewer toolbar */}
          <div className="toolbar-section" id="toolbar-viewer" style={{ display: activeTab === 'viewer' ? 'flex' : 'none' }}>
            <button className="btn btn-primary" onClick={() => handleOpenFolder(null)}>Drives</button>
            <span id="current-file" title={currentFile}>{currentFile}</span>
            <div className="severity-filters">
              {[['All', 0], ['Info', 1], ['Warn', 2], ['Error', 3]].map(([label, sev]) => (
                <button key={sev}
                  className={`sev-btn${severityFilter === sev ? ' active' : ''}`}
                  data-sev={sev}
                  onClick={() => setSeverityFilter(sev)}>
                  {label}
                </button>
              ))}
            </div>
            <input id="filter-input" type="text" placeholder="Filter... (Ctrl+F to find)"
              autoComplete="off" value={filterInputValue} onChange={handleFilterChange} />
            <label className="checkbox-label">
              <input type="checkbox" checked={filterIsRegex} onChange={e => setFilterIsRegex(e.target.checked)} /> Regex
            </label>
            <button className="btn" onClick={openChannelsModal}>&#128221; Channels</button>
            <button className={`btn${tailPaused ? ' active' : ''}`} onClick={() => setTailPaused(p => !p)}>
              {tailPaused ? 'Resume' : 'Pause'}
            </button>
            <button className={`btn${autoScroll ? ' active' : ''}`} onClick={() => {
              setAutoScroll(a => {
                if (!a && scrollWrapRef.current) scrollWrapRef.current.scrollTop = scrollWrapRef.current.scrollHeight;
                return !a;
              });
            }}>Auto-scroll</button>
            <button className="btn" onClick={() => {
              setAllEntries([]);
              setFilteredEntries([]);
              setDetailEntry(null);
              setSelectedIdx(-1);
              setVsRange({ start: 0, end: 100 });
            }}>Clear</button>
            <button className="btn" onClick={handleExportCsv}>CSV</button>
          </div>

          {/* Intune toolbar */}
          <div className="toolbar-section" id="toolbar-intune" style={{ display: activeTab === 'intune' ? 'flex' : 'none' }}>
            <button className="btn btn-primary" onClick={() => intuneTabRef.current?.openFile()}>Load IME Log</button>
            <span style={{ color: 'var(--accent2)', fontSize: '12px' }}>{intuneFileLabel}</span>
            <button className="btn" onClick={() => intuneTabRef.current?.clear()}>Clear</button>
            <span style={{ color: 'var(--text3)', fontSize: '11px' }}>Drag &amp; drop an IME log or AppWorkload log here</span>
          </div>

          {/* DSRegCmd toolbar */}
          <div className="toolbar-section" id="toolbar-dsreg" style={{ display: activeTab === 'dsreg' ? 'flex' : 'none' }}>
            <button className="btn btn-primary" onClick={() => dsregTabRef.current?.analyze()}>Analyze</button>
            <button className="btn" onClick={() => dsregTabRef.current?.clear()}>Clear</button>
            <span style={{ color: 'var(--text3)', fontSize: '11px' }}>Paste output of: <code>dsregcmd /status</code></span>
          </div>

          {/* Always-visible right controls */}
          <div className="toolbar-right">
            <select value={theme} title="Theme" onChange={e => setTheme(e.target.value)}>
              <option value="dark">Dark</option>
              <option value="dracula">Dracula</option>
              <option value="nord">Nord</option>
              <option value="solarized">Solarized</option>
              <option value="hotdog">Hot Dog Stand</option>
            </select>
            <div className="font-controls">
              <button className="btn btn-icon" title="Decrease font size" onClick={() => setFontSize(s => Math.max(10, s - 1))}>A-</button>
              <span id="font-size-display">{fontSize}px</span>
              <button className="btn btn-icon" title="Increase font size" onClick={() => setFontSize(s => Math.min(20, s + 1))}>A+</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div id="main">

        {/* ═══ Log Viewer Tab ══════════════════════════════════════════════ */}
        <div className={`tab-content${activeTab === 'viewer' ? ' active' : ''}`} data-tab="viewer">
          <div id="sidebar" ref={sidebarRef}>
            <div id="quick-links">
              <div id="quick-links-header">Quick Links</div>
              <ul id="quick-links-list">
                <li onClick={openAnsibleLog}><span className="icon">&#128280;</span><span className="name">Ansible Playbook Log</span></li>
              </ul>
            </div>
            <div id="sidebar-header">&#128193; File Browser</div>
            <div id="sidebar-path" title={browserData.current}>{browserData.current}</div>
            <ul id="file-list">
              {browserData.parent !== null && (
                <li className="parent-dir" onClick={() => handleOpenFolder(browserData.parent)}>
                  <span className="icon">&#8593;</span><span className="name">..</span>
                </li>
              )}
              {browserData.entries.length === 0 && <li className="loading">Loading...</li>}
              {browserData.entries.map((entry, i) => {
                const entryPath = browserData.isRoot
                  ? entry.name
                  : browserData.current + '\\' + entry.name;
                return entry.isDir ? (
                  <li key={i} className="dir" onClick={() => handleOpenFolder(entryPath)}>
                    <span className="icon">&#128193;</span><span className="name">{entry.name}</span>
                  </li>
                ) : (
                  <li key={i} className={`log-file${selectedFile === entryPath ? ' selected' : ''}`}
                    onClick={() => handleOpenFile(entryPath)}>
                    <span className="icon">&#128196;</span><span className="name">{entry.name}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div id="resizer" ref={resizerRef}></div>

          <div id="viewer"
            className={viewerDragOver ? 'drag-over' : ''}
            onDragOver={onViewerDragOver}
            onDragLeave={onViewerDragLeave}
            onDrop={onViewerDrop}>

            {/* Find bar */}
            <div id="find-bar" className={showFindBar ? '' : 'hidden'}>
              <input ref={findInputRef} id="find-input" type="text" placeholder="Find in log..."
                autoComplete="off" value={findInputValue} onChange={handleFindChange} />
              <label className="checkbox-label">
                <input type="checkbox" checked={findIsRegex} onChange={e => setFindIsRegex(e.target.checked)} /> Regex
              </label>
              <span id="find-count">
                {findResults.length ? `${findIdx + 1} / ${findResults.length}` : (findText ? 'No matches' : '')}
              </span>
              <button className="btn btn-icon" title="Previous (Shift+F3)" onClick={prevFind}>&#9650;</button>
              <button className="btn btn-icon" title="Next (F3)" onClick={nextFind}>&#9660;</button>
              <button className="btn btn-icon" title="Close (Esc)" onClick={() => { setShowFindBar(false); setFindText(''); setFindInputValue(''); }}>&#10005;</button>
            </div>

            {/* Column header */}
            <div id="log-header" ref={logHeaderRef} className="log-grid" style={{ display: allEntries.length > 0 ? 'grid' : 'none' }}>
              <span className="col-time">Time<i className="col-rz" data-col="0"></i></span>
              <span className="col-date">Date<i className="col-rz" data-col="1"></i></span>
              <span className="col-comp">Component<i className="col-rz" data-col="2"></i></span>
              <span className="col-thread">Thread<i className="col-rz" data-col="3"></i></span>
              <span className="col-delta">Delta<i className="col-rz" data-col="4"></i></span>
              <span className="col-type">Type<i className="col-rz" data-col="5"></i></span>
              <span className="col-message">Message</span>
            </div>

            {/* Virtual scroll */}
            <div id="log-scroll-wrap" ref={scrollWrapRef}
              style={{ display: allEntries.length > 0 ? 'block' : 'none' }}
              onScroll={handleScroll}>
              <div id="log-scroll-inner" style={{ height: totalRows * ROW_HEIGHT + 'px' }}>
                {rowsToRender.map((entry, i) => {
                  const idx = vsStart + i;
                  const delta = idx > 0 ? calcDelta(filteredEntries[idx - 1], entry) : '';
                  const isFindMatch = findResultSet.has(idx);
                  const isFindCurr  = findIdx >= 0 && findResults[findIdx] === idx;
                  return (
                    <div
                      key={idx}
                      className={`log-row type-${entry.type || 1}${idx === selectedIdx ? ' selected' : ''}${isFindMatch ? ' find-match' : ''}${isFindCurr ? ' find-current' : ''}`}
                      style={{ top: idx * ROW_HEIGHT + 'px' }}
                      data-idx={idx}
                      onClick={() => {
                        setSelectedIdx(idx);
                        setDetailEntry(entry);
                      }}
                      onDoubleClick={() => showRowModal(entry)}
                    >
                      <span className="col-time">{entry.time || ''}</span>
                      <span className="col-date">{entry.date || ''}</span>
                      <span className="col-comp">{entry.component || ''}</span>
                      <span className="col-thread">{entry.thread || ''}</span>
                      <span className="col-delta">{delta}</span>
                      <span className="col-type">{entry.typeName || 'Info'}</span>
                      <span className="col-message">{entry.message || ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Empty state */}
            <div id="empty-state" style={{ display: allEntries.length > 0 ? 'none' : 'flex' }}>
              <span className="big">&#128196;</span>
              <span>Select a log file from the browser on the left</span>
              <span className="sub">or drag &amp; drop a file anywhere here</span>
            </div>

            {/* Detail panel */}
            <div id="detail-panel" className={detailEntry ? 'visible' : ''}>
              {detailContent}
            </div>
          </div>
        </div>

        {/* ═══ Intune Tab ══════════════════════════════════════════════════ */}
        <div className={`tab-content${activeTab === 'intune' ? ' active' : ''}`} data-tab="intune">
          <IntuneTab ref={intuneTabRef} onFileLabelChange={setIntuneFileLabel} />
        </div>

        {/* ═══ DSRegCmd Tab ════════════════════════════════════════════════ */}
        <div className={`tab-content${activeTab === 'dsreg' ? ' active' : ''}`} data-tab="dsreg">
          <DsregTab ref={dsregTabRef} />
        </div>

      </div>

      {/* ── Status bar ──────────────────────────────────────────────────────── */}
      <div id="statusbar">
        <span>{statusEntries}</span>
        <span>{statusFiltered}</span>
        <span>{statusWatching}</span>
        <span>{statusErrors}</span>
      </div>

      {/* ── Row detail modal ────────────────────────────────────────────────── */}
      {rowModal.show && (
        <div className="modal-overlay" role="dialog" aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setRowModal(m => ({ ...m, show: false })); }}>
          <div className="modal-dialog">
            <div className="modal-header">
              <span className="modal-title">{rowModal.title}</span>
              <button className="modal-close" title="Close (Esc)" onClick={() => setRowModal(m => ({ ...m, show: false }))}>&#10005;</button>
            </div>
            <div className="modal-body">
              {rowModal.fields.filter(f => f.value).map((f, i) => (
                <div key={i}>
                  <div className="modal-field-label">{f.label}</div>
                  <div className={`modal-field-value${f.cls ? ' ' + f.cls : ''}`}>{f.value}</div>
                </div>
              ))}
              {rowModal.errorCodes.length > 0 && (
                <div className="modal-error-codes">
                  <div className="modal-error-codes-title">&#128270; Error Codes Found</div>
                  {rowModal.errorCodes.map((c, i) => (
                    <div key={i} className="modal-error-code-row">
                      <span className="modal-ec-code">{c.code}</span>
                      <span className="modal-ec-desc">{c.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Channel picker modal ─────────────────────────────────────────────── */}
      {channelModal.show && (
        <div className="modal-overlay" role="dialog" aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setChannelModal(m => ({ ...m, show: false })); }}>
          <div className="modal-dialog channel-modal-dialog">
            <div className="modal-header">
              <span className="modal-title">&#128221; Windows Event Channels</span>
              <button className="modal-close" title="Close (Esc)" onClick={() => setChannelModal(m => ({ ...m, show: false }))}>&#10005;</button>
            </div>
            <div className="channel-search-wrap">
              <input type="text" placeholder="Search channels..." autoComplete="off"
                value={channelModal.search}
                onChange={e => setChannelModal(m => ({ ...m, search: e.target.value }))}
                autoFocus />
            </div>
            <div id="channel-list-wrap">
              {channelModal.loading ? (
                <div className="channel-list-msg">Loading channels...</div>
              ) : (
                <ul id="channel-list">
                  {filteredChannels.length === 0
                    ? <li style={{ color: 'var(--text3)', cursor: 'default' }}>No channels match</li>
                    : filteredChannels.map((c, i) => {
                        const isCommon = COMMON_CHANNELS.some(cc => cc.toLowerCase() === c.toLowerCase());
                        return (
                          <li key={i} className={isCommon ? 'evtx-common' : ''} title={c}
                            onClick={() => openChannel(c)}>
                            {c}
                          </li>
                        );
                      })
                  }
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
