import { useState, useEffect, useCallback, useRef } from 'react';
import { socket } from './socket';
import { findErrorCodesInText } from './utils/errorCodes';
import IntuneTab from './components/IntuneTab';
import DsregTab from './components/DsregTab';
import { FileSymlink, Eraser, Pause, Play, ArrowDownToLine  } from 'lucide-react';
import { LuLogs } from "react-icons/lu";
import { BsFileSpreadsheet } from "react-icons/bs";
import { LuScroll } from "react-icons/lu";
import { FaTools } from "react-icons/fa";
import { MdOutlineDomainVerification } from "react-icons/md";
import { PiFolderSimpleDuotone, PiFileTextFill } from "react-icons/pi";
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

  // ── Log state (non-paged: plain logs, ansible, etc.) ──────────────────────
  const [currentFile, setCurrentFile] = useState('No file open');
  const [statusWatching, setStatusWatching] = useState('');
  const [tailPaused, setTailPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [allEntries, setAllEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [detailEntry, setDetailEntry] = useState(null);

  // ── Paged mode (evtx files + WinEvent channels) ───────────────────────────
  const [isPaginated, setIsPaginated] = useState(false);
  const [logInfo, setLogInfo] = useState({ total: 0, rawTotal: 0, errCount: 0, warnCount: 0 });
  const [pageStore, setPageStore] = useState(new Map()); // pageIdx → entries[]
  const [liveEntries, setLiveEntries] = useState([]);    // WebSocket tail events
  const [pageSize, setPageSize] = useState(50);          // rows per viewport page

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

  // ── Quick Links ───────────────────────────────────────────────────────────
  const [customQuickLinks, setCustomQuickLinks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('aicm-quick-links')) || []; } catch { return []; }
  });
  const [quickLinksDragOver, setQuickLinksDragOver] = useState(false);
  const [quickLinkPathPrompt, setQuickLinkPathPrompt] = useState(null);

  // ── Remote computer ───────────────────────────────────────────────────────
  const [remoteComputer, setRemoteComputer] = useState(() => localStorage.getItem('aicm-remote') || '');

  // ── Appearance ────────────────────────────────────────────────────────────
  const [fontSize, setFontSize] = useState(() => parseInt(localStorage.getItem('aicm-font') || '13', 10));
  const [theme, setTheme] = useState(() => localStorage.getItem('aicm-theme') || 'dmdark');

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

  // Paged mode refs (allow stable callbacks to read current state)
  const isPaginatedRef    = useRef(false);
  const logInfoRef        = useRef({ total: 0, rawTotal: 0, errCount: 0, warnCount: 0 });
  const pageStoreRef      = useRef(new Map());
  const liveEntriesRef    = useRef([]);
  const pageSizeRef       = useRef(50);
  const pagedSourceRef    = useRef(null); // { channel?, path?, remote? }
  const fetchingRef       = useRef(new Set());
  const activeFiltersRef  = useRef({ level: 0, text: '', regex: false });
  const fetchGenRef       = useRef(0);   // bumped on source/filter change; stale responses are dropped

  // ── Keep refs in sync ─────────────────────────────────────────────────────
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);
  useEffect(() => { tailPausedRef.current = tailPaused; }, [tailPaused]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { filteredEntriesRef.current = filteredEntries; }, [filteredEntries]);
  useEffect(() => { findResultsRef.current = findResults; }, [findResults]);
  useEffect(() => { findIdxRef.current = findIdx; }, [findIdx]);
  useEffect(() => { isPaginatedRef.current = isPaginated; }, [isPaginated]);
  useEffect(() => { logInfoRef.current = logInfo; }, [logInfo]);
  useEffect(() => { pageStoreRef.current = pageStore; }, [pageStore]);
  useEffect(() => { liveEntriesRef.current = liveEntries; }, [liveEntries]);
  useEffect(() => { pageSizeRef.current = pageSize; }, [pageSize]);

  // ── Persist quick links + remote ─────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('aicm-quick-links', JSON.stringify(customQuickLinks));
  }, [customQuickLinks]);

  useEffect(() => { localStorage.setItem('aicm-remote', remoteComputer); }, [remoteComputer]);

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

  // ── Page size from viewport (computed on mount + window resize) ───────────
  useEffect(() => {
    const update = () => {
      if (scrollWrapRef.current) {
        const ps = Math.max(20, Math.ceil(scrollWrapRef.current.clientHeight / ROW_HEIGHT));
        setPageSize(ps);
        pageSizeRef.current = ps;
      }
    };
    window.addEventListener('resize', update);
    requestAnimationFrame(update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // ── Keep activeFiltersRef in sync on every filter change ─────────────────
  useEffect(() => {
    activeFiltersRef.current = { level: severityFilter, text: filterText, regex: filterIsRegex };
  }, [severityFilter, filterText, filterIsRegex]);

  // ── Paged mode: server re-fetch on filter change only ────────────────────
  // Depends only on filter values — NOT allEntries — so it doesn't fire when
  // a new source is opened (which would race with the openChannel inline fetch).
  useEffect(() => {
    if (!isPaginatedRef.current) return;
    const src = pagedSourceRef.current;
    if (!src) return;

    setPageStore(new Map());
    pageStoreRef.current = new Map();
    fetchingRef.current.clear();
    fetchGenRef.current++;
    const filterGen = fetchGenRef.current;
    setLiveEntries([]);
    liveEntriesRef.current = [];

    const ps = pageSizeRef.current;
    const initialOffset = autoScrollRef.current ? 'end' : '0';
    const params = new URLSearchParams({ ...src, offset: initialOffset, count: ps * 3, ps });
    if (severityFilter > 0) params.set('level', severityFilter);
    if (filterText) { params.set('text', filterText); if (filterIsRegex) params.set('regex', 'true'); }

    fetch(`/api/evtx?${params}`)
      .then(r => r.json())
      .then(data => {
        if (fetchGenRef.current !== filterGen) return;
        if (data.error) return;
        setLogInfo(prev => ({ ...prev, total: data.total }));
        logInfoRef.current = { ...logInfoRef.current, total: data.total };

        const actualOffset = data.offset || 0;
        const entries = data.entries || [];
        const pages = new Map();
        for (let p = 0; p * ps < entries.length; p++) {
          pages.set(Math.floor(actualOffset / ps) + p, entries.slice(p * ps, (p + 1) * ps));
        }
        setPageStore(pages);
        pageStoreRef.current = pages;

        requestAnimationFrame(() => {
          if (!scrollWrapRef.current) return;
          scrollWrapRef.current.scrollTop = autoScrollRef.current
            ? scrollWrapRef.current.scrollHeight
            : 0;
        });
      })
      .catch(() => {});
  }, [severityFilter, filterText, filterIsRegex]);

  // ── Non-paged mode: client-side filter on new entries or filter change ────
  useEffect(() => {
    if (isPaginatedRef.current) return;
    const fn = makeFilter(severityFilter, filterText, filterIsRegex);
    setFilteredEntries(allEntries.filter(fn));
  }, [severityFilter, filterText, filterIsRegex, allEntries]);

  // ── Virtual scroll reset + auto-scroll (non-paged) ────────────────────────
  useEffect(() => {
    if (isPaginatedRef.current) return;
    filteredEntriesRef.current = filteredEntries;
    const total = filteredEntries.length;
    const wrap = scrollWrapRef.current;
    const viewH = wrap ? (wrap.clientHeight || 400) : 400;
    const visibleRows = Math.ceil(viewH / ROW_HEIGHT);

    if (autoScrollRef.current) {
      const end = Math.max(0, total - 1);
      setVsRange({ start: Math.max(0, end - visibleRows - BUFFER), end });
      requestAnimationFrame(() => {
        if (scrollWrapRef.current) scrollWrapRef.current.scrollTop = scrollWrapRef.current.scrollHeight;
      });
    } else if (wrap) {
      const scrollTop = wrap.scrollTop;
      const visStart = Math.floor(scrollTop / ROW_HEIGHT);
      const visEnd   = Math.ceil((scrollTop + viewH) / ROW_HEIGHT);
      setVsRange({
        start: Math.max(0, visStart - BUFFER),
        end:   Math.min(total - 1, visEnd + BUFFER),
      });
    }
  }, [filteredEntries]);

  // ── Virtual scroll reset + auto-scroll (paged) ────────────────────────────
  useEffect(() => {
    if (!isPaginated) return;
    const total = logInfo.total + liveEntries.length;
    const wrap = scrollWrapRef.current;
    const viewH = wrap ? (wrap.clientHeight || 400) : 400;
    const visibleRows = Math.ceil(viewH / ROW_HEIGHT);

    if (autoScrollRef.current) {
      const end = Math.max(0, total - 1);
      setVsRange({ start: Math.max(0, end - visibleRows - BUFFER), end });
      requestAnimationFrame(() => {
        if (scrollWrapRef.current) scrollWrapRef.current.scrollTop = scrollWrapRef.current.scrollHeight;
      });
    } else if (wrap) {
      const scrollTop = wrap.scrollTop;
      const visStart = Math.floor(scrollTop / ROW_HEIGHT);
      const visEnd   = Math.ceil((scrollTop + viewH) / ROW_HEIGHT);
      setVsRange({
        start: Math.max(0, visStart - BUFFER),
        end:   Math.min(total - 1, visEnd + BUFFER),
      });
    }
  }, [isPaginated, logInfo.total, liveEntries.length]);

  // ── Find ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const matcher = makeFindMatcher(findText, findIsRegex);

    if (isPaginatedRef.current) {
      // Server-side search through cached entries
      if (!findText) { setFindResults([]); setFindIdx(-1); return; }
      const src = pagedSourceRef.current;
      if (!src) return;
      const { level, text, regex } = activeFiltersRef.current;
      const params = new URLSearchParams({ ...src, find: findText });
      if (findIsRegex) params.set('findRegex', 'true');
      if (level > 0) params.set('level', level);
      if (text) { params.set('text', text); if (regex) params.set('regex', 'true'); }

      fetch(`/api/evtx/search?${params}`)
        .then(r => r.json())
        .then(data => {
          const results = data.matches || [];
          setFindResults(results);
          setFindIdx(results.length ? 0 : -1);
        })
        .catch(() => {});
      return;
    }

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
      setVsRange(prev => ({ ...prev }));
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
      if (isPaginatedRef.current) {
        const { level, text, regex } = activeFiltersRef.current;
        const fn = makeFilter(level, text, regex);
        const kept = newE.filter(fn);
        if (kept.length) setLiveEntries(prev => [...prev, ...kept]);
      } else {
        setAllEntries(prev => [...prev, ...newE]);
      }
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
    // Paged mode reset
    setIsPaginated(false);
    isPaginatedRef.current = false;
    setLogInfo({ total: 0, rawTotal: 0, errCount: 0, warnCount: 0 });
    logInfoRef.current = { total: 0, rawTotal: 0, errCount: 0, warnCount: 0 };
    setPageStore(new Map());
    pageStoreRef.current = new Map();
    setLiveEntries([]);
    liveEntriesRef.current = [];
    fetchingRef.current.clear();
    fetchGenRef.current++;
    pagedSourceRef.current = null;
  }, []);

  // ── Paged mode: fetch a single page from the server ───────────────────────
  const fetchPage = useCallback((pageIdx) => {
    const src = pagedSourceRef.current;
    if (!src) return;
    if (fetchingRef.current.has(pageIdx)) return;
    if (pageStoreRef.current.has(pageIdx)) return;

    fetchingRef.current.add(pageIdx);
    const gen = fetchGenRef.current;
    const ps = pageSizeRef.current;
    const { level, text, regex } = activeFiltersRef.current;
    const params = new URLSearchParams({ ...src, offset: pageIdx * ps, count: ps, ps });
    if (level > 0) params.set('level', level);
    if (text) { params.set('text', text); if (regex) params.set('regex', 'true'); }

    fetch(`/api/evtx?${params}`)
      .then(r => r.json())
      .then(data => {
        if (fetchGenRef.current !== gen) return; // stale — filter or source changed
        if (data.error) return;
        setPageStore(prev => {
          if (prev.has(pageIdx)) return prev;
          const next = new Map(prev);
          next.set(pageIdx, data.entries || []);
          return next;
        });
      })
      .catch(() => {})
      .finally(() => { fetchingRef.current.delete(pageIdx); });
  }, []);

  // ── Paged mode: evict pages outside the topPage-1 … bottomPage+1 window ──
  const evictPages = useCallback((topPage, bottomPage) => {
    const keep = new Set();
    for (let p = topPage - 1; p <= bottomPage + 1; p++) {
      if (p >= 0) keep.add(p);
    }
    setPageStore(prev => {
      let changed = false;
      const next = new Map();
      for (const [k, v] of prev) {
        if (keep.has(k)) next.set(k, v);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  const [evtxLoading, setEvtxLoading] = useState((t)=>{
    return false;
  });

  const handleOpenFile = useCallback((filePath) => {
    socket.emit('unwatch');
    setTailPaused(false);
    setSelectedFile(filePath);
    resetViewer();
    setCurrentFile(filePath);
    setActiveTab('viewer');

    const fileName = filePath.split(/[\\/]/).pop();
    const isEvtx = fileName.toLowerCase().endsWith('.evtx');
    document.title = `${fileName} - Log Viewer`;

    if (isEvtx) {
      const ps = pageSizeRef.current;
      pagedSourceRef.current = { path: filePath };
      setIsPaginated(true);
      isPaginatedRef.current = true;
      const openGen = fetchGenRef.current;

      const initialOffset = autoScrollRef.current ? 'end' : '0';
      const { level: initLevel, text: initText, regex: initRegex } = activeFiltersRef.current;
      const params = new URLSearchParams({ path: filePath, offset: initialOffset, count: ps * 3, ps });
      if (initLevel > 0) params.set('level', initLevel);
      if (initText) { params.set('text', initText); if (initRegex) params.set('regex', 'true'); }

      setEvtxLoading(true);

      fetch(`/api/evtx?${params}`)
        .then(r => r.json())
        .then(data => {
          if (fetchGenRef.current !== openGen) return;
          if (data.error) throw new Error(data.error);
          const info = { total: data.total, rawTotal: data.rawTotal, errCount: data.errCount, warnCount: data.warnCount };
          setLogInfo(info);
          logInfoRef.current = info;

          const actualOffset = data.offset || 0;
          const entries = data.entries || [];
          const pages = new Map();
          for (let p = 0; p * ps < entries.length; p++) {
            pages.set(Math.floor(actualOffset / ps) + p, entries.slice(p * ps, (p + 1) * ps));
          }
          setPageStore(pages);
          pageStoreRef.current = pages;
          setStatusWatching(`📄 ${fileName} (snapshot)`);
          setEvtxLoading(false);
        })
        .catch(err => {
          setIsPaginated(false);
          isPaginatedRef.current = false;
          pagedSourceRef.current = null;
          setAllEntries([{ type: 3, message: `Error: ${err.message}`, time: '', date: '', component: '', thread: '', typeName: 'Error' }]);
          setStatusWatching('');
          setEvtxLoading(false);
        });
    } else {
      fetch(`/api/read?path=${encodeURIComponent(filePath)}`)
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          setAllEntries(data.entries || []);
          socket.emit('watch', { path: filePath });
          setStatusWatching(`🔒 Watching: ${fileName}`);
          setEvtxLoading(false);
        })
        .catch(err => {
          setAllEntries([{ type: 3, message: `Error: ${err.message}`, time: '', date: '', component: '', thread: '', typeName: 'Error' }]);
          setStatusWatching('');
          setEvtxLoading(false);
        });
    }
  }, [resetViewer]);

  const openChannel = useCallback((channelName) => {
    socket.emit('unwatch');
    setTailPaused(false);
    resetViewer();
    setCurrentFile(channelName);
    setActiveTab('viewer');
    document.title = `${channelName.split('/').pop()} - Log Viewer`;

    const ps = pageSizeRef.current;
    const src = { channel: channelName, ...(remoteComputer ? { remote: remoteComputer } : {}) };
    pagedSourceRef.current = src;
    setIsPaginated(true);
    isPaginatedRef.current = true;
    const openGen = fetchGenRef.current;

    const initialOffset = autoScrollRef.current ? 'end' : '0';
    const { level: initLevel, text: initText, regex: initRegex } = activeFiltersRef.current;
    const params = new URLSearchParams({ ...src, offset: initialOffset, count: ps * 3, ps });
    if (initLevel > 0) params.set('level', initLevel);
    if (initText) { params.set('text', initText); if (initRegex) params.set('regex', 'true'); }

    setEvtxLoading(true);
    setChannelModal(m => ({ ...m, show: false }));

    fetch(`/api/evtx?${params}`)
      .then(r => r.json())
      .then(data => {
        if (fetchGenRef.current !== openGen) return;
        if (data.error) throw new Error(data.error);
        const info = { total: data.total, rawTotal: data.rawTotal, errCount: data.errCount, warnCount: data.warnCount };
        setLogInfo(info);
        logInfoRef.current = info;

        const actualOffset = data.offset || 0;
        const entries = data.entries || [];
        const pages = new Map();
        for (let p = 0; p * ps < entries.length; p++) {
          pages.set(Math.floor(actualOffset / ps) + p, entries.slice(p * ps, (p + 1) * ps));
        }
        setPageStore(pages);
        pageStoreRef.current = pages;

        // Live tail starts from the newest event's timestamp (returned by server)
        const since = data.sinceIsoTime || new Date().toISOString();
        const watchPayload = { channel: channelName, since };
        if (remoteComputer) watchPayload.remote = remoteComputer;
        socket.emit('watch:channel', watchPayload);
        setStatusWatching(`🔒 Live: ${remoteComputer ? remoteComputer + ' — ' : ''}${channelName}`);
        setChannelModal(m => ({ ...m, show: false }));
        setEvtxLoading(false);
      })
      .catch(err => {
        setIsPaginated(false);
        isPaginatedRef.current = false;
        pagedSourceRef.current = null;
        setAllEntries([{ type: 3, message: `Error: ${err.message}`, time: '', date: '', component: '', thread: '', typeName: 'Error' }]);
        setEvtxLoading(false);
      });
  }, [resetViewer, remoteComputer]);

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
    const scrollTop = wrap.scrollTop;
    const viewH = wrap.clientHeight || 400;

    const total = isPaginatedRef.current
      ? logInfoRef.current.total + liveEntriesRef.current.length
      : filteredEntriesRef.current.length;
    if (!total) return;

    const visStart = Math.floor(scrollTop / ROW_HEIGHT);
    const visEnd   = Math.ceil((scrollTop + viewH) / ROW_HEIGHT);
    setVsRange({
      start: Math.max(0, visStart - BUFFER),
      end:   Math.min(total - 1, visEnd + BUFFER),
    });

    if (isPaginatedRef.current) {
      const ps = pageSizeRef.current;
      const topPage    = Math.floor(scrollTop / (ps * ROW_HEIGHT));
      const bottomPage = Math.floor((scrollTop + viewH) / (ps * ROW_HEIGHT));
      const maxPage    = Math.ceil(logInfoRef.current.total / ps) - 1;

      evictPages(topPage, bottomPage);

      for (let p = Math.max(0, topPage - 1); p <= Math.min(maxPage, bottomPage + 1); p++) {
        fetchPage(p);
      }
    }
  }, [evictPages, fetchPage]);

  // ── Quick links actions ───────────────────────────────────────────────────
  const addQuickLink = useCallback((filePath) => {
    if (!filePath) return;
    setCustomQuickLinks(prev => {
      if (prev.some(l => l.path === filePath)) return prev;
      const name = filePath.split(/[\\/]/).pop();
      return [...prev, { id: Date.now(), path: filePath, name }];
    });
  }, []);

  const removeQuickLink = useCallback((id) => {
    setCustomQuickLinks(prev => prev.filter(l => l.id !== id));
  }, []);

  const onQuickLinksDragOver  = (e) => { e.preventDefault(); setQuickLinksDragOver(true); };
  const onQuickLinksDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setQuickLinksDragOver(false); };
  const onQuickLinksDrop = (e) => {
    e.preventDefault();
    setQuickLinksDragOver(false);
    const custom = e.dataTransfer.getData('text/x-file-path');
    if (custom) { addQuickLink(custom.trim()); return; }
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const eApi = window.electronAPI ?? window.parent?.electronAPI;
    const electronPath = eApi?.getPathForFile?.(file);
    if (electronPath) { addQuickLink(electronPath); return; }
    setQuickLinkPathPrompt(file.name);
  };

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
      if (m.channels && m.remote === remoteComputer) return { ...m, show: true, search: '' };
      const url = '/api/evtx/channels' + (remoteComputer ? '?remote=' + encodeURIComponent(remoteComputer) : '');
      fetch(url)
        .then(r => r.json())
        .then(data => setChannelModal(prev => ({ ...prev, channels: data.channels || [], loading: false })))
        .catch(() => setChannelModal(prev => ({ ...prev, channels: [], loading: false })));
      return { ...m, show: true, search: '', loading: true, channels: null, remote: remoteComputer };
    });
  }, [remoteComputer]);

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
  const handleExportCsv = useCallback(async () => {
    let entries;
    if (isPaginatedRef.current) {
      const src = pagedSourceRef.current;
      if (!src) return;
      const { level, text, regex } = activeFiltersRef.current;
      const ps = pageSizeRef.current;
      const params = new URLSearchParams({ ...src, offset: 0, count: 100000, ps });
      if (level > 0) params.set('level', level);
      if (text) { params.set('text', text); if (regex) params.set('regex', 'true'); }
      const data = await fetch(`/api/evtx?${params}`).then(r => r.json()).catch(() => ({ entries: [] }));
      entries = data.entries || [];
    } else {
      entries = filteredEntriesRef.current;
    }
    if (!entries.length) return;
    const rows = ['Time,Date,Component,Thread,Delta,Type,Message'];
    entries.forEach((e, i) => {
      const delta = i > 0 ? calcDelta(entries[i - 1], e) : '';
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
  const statusEntries = isPaginated
    ? `${logInfo.rawTotal.toLocaleString()} entries`
    : `${allEntries.length} entries`;
  const statusFiltered = isPaginated
    ? (logInfo.total !== logInfo.rawTotal ? `${logInfo.total.toLocaleString()} shown` : '')
    : (filteredEntries.length !== allEntries.length ? `${filteredEntries.length} shown` : '');
  const statusErrors = isPaginated
    ? ((logInfo.errCount || logInfo.warnCount) ? `${logInfo.errCount} errors  ${logInfo.warnCount} warnings` : '')
    : (() => {
        const errs  = allEntries.filter(e => e.type === 3).length;
        const warns = allEntries.filter(e => e.type === 2).length;
        return (errs || warns) ? `${errs} errors  ${warns} warnings` : '';
      })();

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

  // ── Render-time helpers ───────────────────────────────────────────────────
  const { start: vsStart, end: vsEnd } = vsRange;
  const totalRows = isPaginated
    ? logInfo.total + liveEntries.length
    : filteredEntries.length;
  const hasEntries = isPaginated ? logInfo.rawTotal > 0 : allEntries.length > 0;
  const findResultSet = new Set(findResults);

  function getEntryAt(i) {
    if (!isPaginated) return filteredEntries[i] ?? null;
    if (i < logInfo.total) {
      return pageStore.get(Math.floor(i / pageSize))?.[i % pageSize] ?? null;
    }
    return liveEntries[i - logInfo.total] ?? null;
  }

  return (
    <div className="mainSection">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div id="topbar">
        <div id="tab-bar">
          <button className={`tab-btn${activeTab === 'viewer' ? ' active' : ''}`} onClick={() => setActiveTab('viewer')}><LuScroll size={12} style={{ display:"inline-block", marginRight: '4px' }} /> Log Viewer</button>
          <button className={`tab-btn${activeTab === 'intune' ? ' active' : ''}`} onClick={() => setActiveTab('intune')}><FaTools size={12} style={{ display:"inline-block", marginRight: '4px' }} /> Intune Diagnostics</button>
          <button className={`tab-btn${activeTab === 'dsreg'  ? ' active' : ''}`} onClick={() => setActiveTab('dsreg')}><MdOutlineDomainVerification size={14} style={{ display:"inline-block", marginRight: '4px' }} /> DSRegCmd</button>
        </div>

        <div id="toolbar">
          {/* Log Viewer toolbar */}
          <div className="toolbar-section" id="toolbar-viewer" style={{ display: activeTab === 'viewer' ? 'flex' : 'none' }}>
            <button className="btn btn-primary" onClick={() => handleOpenFolder(null)}>Drives</button>
            <span id="current-file" title={currentFile}>{currentFile}</span>
            <div className="severity-filters" style={{ marginRight: '20px' }}>
              {[['All', 0], ['Info', 1], ['Warn', 2], ['Error', 3]].map(([label, sev]) => (
                <button key={sev}
                  className={`sev-btn${severityFilter === sev ? ' active' : ''}`}
                  data-sev={sev}
                  onClick={() => setSeverityFilter(sev)}>
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0px 10px', marginRight: '20px'}}>
              <input id="filter-input" type="text" placeholder="Filter... (Ctrl+F to find)"
                autoComplete="off" value={filterInputValue} onChange={handleFilterChange} />
              <label className="checkbox-label">
                <input type="checkbox" checked={filterIsRegex} onChange={e => setFilterIsRegex(e.target.checked)} /> Regex
              </label>
            </div>

            <div className="remote-input-wrap">
              <span className="remote-label">&#128187; Remote:</span>
              <input className="remote-input" type="text" placeholder="localhost"
                value={remoteComputer}
                onChange={e => setRemoteComputer(e.target.value.trim())}
                title="Leave blank for local machine" />
            </div>
            <button className="btn" onClick={openChannelsModal}><LuLogs size={12} style={{ display:"inline-block", marginRight: '4px' }} /> WinEvent Channels</button>
            <button className={`btn${tailPaused ? ' active' : ''}`} onClick={() => setTailPaused(p => !p)}>
              {tailPaused ? <Play size={12} style={{ display:"inline-block", marginRight: '4px' }} /> : <Pause size={12} style={{ display:"inline-block", marginRight: '4px' }} />}
              {tailPaused ? 'Resume' : 'Pause'}
            </button>
            <button className={`btn${autoScroll ? ' active' : ''}`} onClick={() => {
              setAutoScroll(a => {
                if (!a && scrollWrapRef.current) scrollWrapRef.current.scrollTop = scrollWrapRef.current.scrollHeight;
                return !a;
              });
            }}><ArrowDownToLine size={12} style={{ display:"inline-block", marginRight: '4px' }} />Auto-scroll</button>
            <button className="btn" onClick={() => {
              setAllEntries([]);
              setFilteredEntries([]);
              setDetailEntry(null);
              setSelectedIdx(-1);
              setVsRange({ start: 0, end: 100 });
              setIsPaginated(false);
              isPaginatedRef.current = false;
              setLogInfo({ total: 0, rawTotal: 0, errCount: 0, warnCount: 0 });
              logInfoRef.current = { total: 0, rawTotal: 0, errCount: 0, warnCount: 0 };
              setPageStore(new Map());
              pageStoreRef.current = new Map();
              setLiveEntries([]);
              liveEntriesRef.current = [];
              fetchingRef.current.clear();
              pagedSourceRef.current = null;
            }}><Eraser size={12} style={{ display:"inline-block", marginRight: '4px' }} />Clear</button>
            <button className="btn" onClick={handleExportCsv}><BsFileSpreadsheet size={12} style={{ display:"inline-block", marginRight: '4px' }} />Export CSV</button>
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
            <select value={theme} style={{ backgroundColor: 'var(--bg1)'}} title="Theme" onChange={e => setTheme(e.target.value)}>
              <option value="dmdark">DM Dark</option>
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
            <div id="quick-links"
              className={quickLinksDragOver ? 'drag-over' : ''}
              onDragOver={onQuickLinksDragOver}
              onDragLeave={onQuickLinksDragLeave}
              onDrop={onQuickLinksDrop}>
              <div id="quick-links-header">Quick Links</div>
              <ul id="quick-links-list">
                <li onClick={openAnsibleLog}><span className="icon">&#128280;</span><span className="name">Ansible Playbook Log</span></li>
                {customQuickLinks.map(link => (
                  <li key={link.id} onClick={() => handleOpenFile(link.path)}>
                    <span className="icon"><PiFileTextFill size={12} color="#a6dbff" style={{ display:"inline-block", marginRight: '4px' }} /></span>
                    <span className="name">{link.name}</span>
                    <button className="quick-link-delete" title="Remove" onClick={(e) => { e.stopPropagation(); removeQuickLink(link.id); }}>&#10005;</button>
                  </li>
                ))}
              </ul>
              {quickLinkPathPrompt && (
                <div className="quick-link-path-form">
                  <div className="quick-link-path-hint">Path for: <em>{quickLinkPathPrompt}</em></div>
                  <input className="quick-link-path-input" autoFocus
                    placeholder="C:\path\to\file"
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') { addQuickLink(ev.target.value.trim()); setQuickLinkPathPrompt(null); }
                      if (ev.key === 'Escape') setQuickLinkPathPrompt(null);
                    }} />
                  <button className="quick-link-path-cancel" onClick={() => setQuickLinkPathPrompt(null)}>&#10005;</button>
                </div>
              )}
            </div>
            <div id="sidebar-header"><PiFolderSimpleDuotone size={18} style={{ display:"inline-block", marginRight: '4px' }} /> File Browser</div>
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
                    <span className="icon"><PiFolderSimpleDuotone size={16} color="#0099ff" style={{ display:"inline-block", marginRight: '4px' }} /></span><span className="name">{entry.name}</span>
                  </li>
                ) : (
                  <li key={i} className={`log-file${selectedFile === entryPath ? ' selected' : ''}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/x-file-path', entryPath)}
                    onClick={() => handleOpenFile(entryPath)}>
                    <span className="icon"><PiFileTextFill size={16} color="#a6dbff" style={{ display:"inline-block", marginRight: '4px' }} /></span><span className="name">{entry.name}</span>
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
            <div id="log-header" ref={logHeaderRef} className="log-grid" style={{ display: hasEntries ? 'grid' : 'none' }}>
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
              style={{ display: hasEntries ? 'block' : 'none' }}
              onScroll={handleScroll}>
              <div id="log-scroll-inner" style={{ height: totalRows * ROW_HEIGHT + 'px' }}>
                {Array.from({ length: Math.max(0, vsEnd - vsStart + 1) }, (_, i) => {
                  const idx = vsStart + i;
                  const entry = getEntryAt(idx);
                  const prevEntry = idx > 0 ? getEntryAt(idx - 1) : null;
                  const delta = prevEntry && entry ? calcDelta(prevEntry, entry) : '';
                  const isFindMatch = findResultSet.has(idx);
                  const isFindCurr  = findIdx >= 0 && findResults[findIdx] === idx;
                  return (
                    <div
                      key={idx}
                      className={`log-row type-${entry ? (entry.type || 1) : 0}${idx === selectedIdx ? ' selected' : ''}${isFindMatch ? ' find-match' : ''}${isFindCurr ? ' find-current' : ''}`}
                      style={{ top: idx * ROW_HEIGHT + 'px' }}
                      data-idx={idx}
                      onClick={() => { if (entry) { setSelectedIdx(idx); setDetailEntry(entry); } }}
                      onDoubleClick={() => entry && showRowModal(entry)}
                    >
                      {entry ? (
                        <>
                          <span className="col-time">{entry.time || ''}</span>
                          <span className="col-date">{entry.date || ''}</span>
                          <span className="col-comp">{entry.component || ''}</span>
                          <span className="col-thread">{entry.thread || ''}</span>
                          <span className="col-delta">{delta}</span>
                          <span className="col-type">{entry.typeName || 'Info'}</span>
                          <span className="col-message">{entry.message || ''}</span>
                        </>
                      ) : (
                        <span className="col-message" style={{ color: 'var(--text3)', fontStyle: 'italic' }}>Loading…</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Empty state */}
            {/* <div id="empty-state" style={{ display: hasEntries ? 'none' : 'flex' }}>               */}
              { 
                evtxLoading ? 
                <div id="empty-state" style={{ display: hasEntries ? 'none' : 'flex' }}>  
                <div className='spinner'></div>
                <div>Loading {currentFile}...</div>
                </div> : 
                <div id="empty-state" style={{ display: hasEntries ? 'none' : 'flex' }}>    
                <span className="big"><FileSymlink size={60} /></span>
                <span>Select a log file from the browser on the left</span>
                <span className="sub">or drag &amp; drop a file anywhere here</span>
                </div>
              }
            {/* </div> */}

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
