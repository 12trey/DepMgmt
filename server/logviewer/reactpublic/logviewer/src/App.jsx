import { useState, useEffect, useCallback } from 'react'
// import reactLogo from './assets/react.svg'
// import viteLogo from './assets/vite.svg'
// import heroImg from './assets/hero.png'
import { socket } from './socket'
import './App.css'

const APIROOT = "http://localhost:4000";
const APIROOT2 = "http://localhost:3000";

function App() {
  var ROW_HEIGHT = 22;

  const [activeTab, switchTab] = useState('viewer');
  const [currentPath, setCurrentPath] = useState('');
  const [displayCurrentPath, setDisplayCurrentPath] = useState('');
  const [browserEntries, setBrowserEntries] = useState([]);
  const [parentPath, setParentPath] = useState('');
  const [currentFile, setCurrentFile] = useState('No file open');

  const [tailPaused, setTailPaused] = useState(false);
  const [allEntries, setAllEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [severityFilter, setSeverityFilter] = useState(0);
  const [filterText, setFilterText] = useState('');
  const [filterIsRegex, setFilterIsRegex] = useState(false);

  const handleTab = (el) => {
    let tabName = el.target.dataset.tab;
    console.log(tabName);
    switchTab(tabName);
  };

  function matchesFilter(e) {
    if (severityFilter > 0 && e.type !== severityFilter) return false;
    if (!filterText) return true;
    if (filterIsRegex) {
      try {
        var re = new RegExp(filterText, 'i');
        return re.test(e.message || '') || re.test(e.component || '') || re.test(e.file || '');
      } catch (_) { return false; }
    }
    var low = filterText.toLowerCase();
    return (e.message && e.message.toLowerCase().indexOf(low) !== -1) ||
      (e.component && e.component.toLowerCase().indexOf(low) !== -1) ||
      (e.file && e.file.toLowerCase().indexOf(low) !== -1);
  }

  function applyFilter(unFilteredEntries) {
    //filteredEntries = allEntries.filter(matchesFilter);
    setAllEntries(unFilteredEntries);
    let filtered = unFilteredEntries.filter(matchesFilter)
    setFilteredEntries(filtered);
    //vsStart = -1; vsEnd = -1;
    //renderVS();
    //if (autoScroll) logScrollWrap.scrollTop = logScrollWrap.scrollHeight;
  }

  function calcDelta(prev, curr) {
    try {
      var a = logTime(prev), b = logTime(curr);
      if (!a || !b) return '';
      var ms = b - a;
      if (ms < 0) return '';
      if (ms < 1000) return '+' + ms + 'ms';
      if (ms < 60000) return '+' + (ms / 1000).toFixed(1) + 's';
      return '+' + Math.floor(ms / 60000) + 'm' + Math.floor((ms % 60000) / 1000) + 's';
    } catch { return ''; }
  }

  function logTime(e) {
    if (!e.time) return null;
    try {
      var d = (e.date || '').replace(/^(\d+)-(\d+)-(\d{4})$/, '$3-$1-$2');
      d = d.replace(/-(\d{1})-/, "-0$1-").replace(/-(\d{1})$/, "-0$1");
      var t = (e.time || '').replace(/[+-]\d+$/, '');
      return new Date(d + 'T' + t);
    } catch { return null; }
  }

  const fetchBrowse = useCallback((dirPath) => {
    var url = `${APIROOT}/api/browse` + (dirPath ? '?path=' + encodeURIComponent(dirPath) : '');
    return fetch(url).then(function (r) { return r.json(); });
  }, []);

  const handleOpenFolder = useCallback((dirPath, isFullPath = false) => {

    //if(dirPath!==undefined) {      
    setCurrentPath((prev) => {
      let fullpath = dirPath; //.replace(/\\$/, "");
      if (!isFullPath)
        if (dirPath != '') fullpath = `${prev}${fullpath ? fullpath : ''}\\`;
        else
          fullpath = `${dirPath}`;

      fetchBrowse(fullpath).then((data) => {
        console.log(data);
        //if(data.parent){
        setParentPath(data.parent);
        //}
        if (data.entries) {
          setBrowserEntries(data.entries.map((e) => {
            return { parent: data.parent, ...e }
          }));
        }
      });

      // only remove ending slash when not at root of volume detected with ":"
      if (fullpath.match(/[^:]\\$/))
        setDisplayCurrentPath(fullpath.replace(/\\$/, ""));
      else
        setDisplayCurrentPath(fullpath); // at root display full path. For example show C:\ not C:

      return fullpath.match(/\\\\$/) ? fullpath.substring(0, fullpath.length - 1) : fullpath;
      //return `${prev}${dirPath?dirPath:''}`
    });
    //}

  }, [fetchBrowse]);

  socket.on('log:lines', (obj) => {
    console.log(obj.entries);
  });

  const handleOpenFile = (filepath) => {
    setCurrentFile(filepath);
    socket.emit('unwatch');
    setTailPaused(false);

    var filename = filepath.split(/[\\/]/).pop();

    var apiUrl = `${APIROOT}/api/read?path=${encodeURIComponent(filepath)}`;

    fetch(apiUrl)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) throw new Error(data.error);

        socket.emit('watch', { path: filepath });
        //allEntries = data.entries || [];        
        applyFilter(data.entries || []);
        //updateStatus();
        // if (!isEvtx) {
        //   socket.emit('watch', { path: filePath });
        //   statusWatching.textContent = '&#128274; Watching: ' + fileName;
        // } else {
        //   statusWatching.textContent = '&#128196; ' + fileName + ' (snapshot)';
        // }
      })
      .catch(function (err) {
        // logScrollInner.style.height = '0px';
        // logScrollInner.innerHTML = '<div style="color:var(--row-err-fg);padding:10px;">&#10060; ' + eh(err.message) + '</div>';
      });
  };

  useEffect(() => {
    const init = () => {
      handleOpenFolder('', true)
    };
    init()
  }, [handleOpenFolder]);

  return (

    <div className='mainSection'>
      <div id="topbar">
        <div id="tab-bar">
          <span className="brand">&#128196; Log Viewer</span>
          <button className={`tab-btn { ${activeTab == 'viewer' ? 'active' : {}}`} data-tab="viewer" onClick={handleTab}>&#128196; Log Viewer</button>
          <button className={`tab-btn { ${activeTab == 'intune' ? 'active' : {}}`} data-tab="intune" onClick={handleTab}>&#128295; Intune Diagnostics</button>
          <button className={`tab-btn { ${activeTab == 'dsreg' ? 'active' : {}}`} data-tab="dsreg" onClick={handleTab}>&#128187; DSRegCmd</button>
        </div>
        <div id="toolbar">
          {/* <!-- Log Viewer controls --> */}
          <div className="toolbar-section" id="toolbar-viewer" style={{ display: activeTab == 'viewer' ? 'flex' : 'none' }}>
            <button id="open-file-btn" className="btn btn-primary" onClick={() => { handleOpenFolder('', true) }} >Drives</button>
            <span id="current-file">{currentFile}</span>
            <div className="severity-filters">
              <button className="sev-btn active" data-sev="0">All</button>
              <button className="sev-btn" data-sev="1">Info</button>
              <button className="sev-btn" data-sev="2">Warn</button>
              <button className="sev-btn" data-sev="3">Error</button>
            </div>
            <input id="filter-input" type="text" placeholder="Filter... (Ctrl+F to find)" autoComplete="off" />
            <label className="checkbox-label"><input type="checkbox" id="filter-regex-cb" /> Regex</label>
            <button id="channels-btn" className="btn">&#128221; Channels</button>
            <button id="pause-btn" className="btn">Pause</button>
            <button id="autoscroll-btn" className="btn active">Auto-scroll</button>
            <button id="clear-btn" className="btn">Clear</button>
            <button id="export-btn" className="btn">CSV</button>
          </div>

          {/* <!-- Intune toolbar (hidden when not on intune tab) --> */}
          <div className="toolbar-section" id="toolbar-intune" style={{ display: activeTab == 'intune' ? 'flex' : 'none' }}>
            <button id="intune-open-btn" className="btn btn-primary">Load IME Log</button>
            <span id="intune-file-label" style={{ color: 'var(--accent2)', fontSize: '12px' }}>No file loaded</span>
            <button id="intune-clear-btn" className="btn">Clear</button>
            <span style={{ color: 'var(--text3)', fontSize: '11px' }}>Drag &amp; drop an IME log or AppWorkload log here</span>
          </div>

          {/* <!-- DSRegCmd toolbar (hidden when not on dsreg tab) --> */}
          <div className="toolbar-section" id="toolbar-dsreg" style={{ display: activeTab == 'dsreg' ? 'flex' : 'none' }}>
            <button id="dsreg-analyze-btn" className="btn btn-primary">Analyze</button>
            <button id="dsreg-clear-btn" className="btn">Clear</button>
            <span style={{ color: 'var(--text3)', fontSize: '11px' }}>Paste output of: <code>dsregcmd /status</code></span>
          </div>

          {/* <!-- Always-visible right controls --> */}
          <div className="toolbar-right">
            <select id="theme-select" title="Theme">
              <option value="dark">Dark</option>
              <option value="dracula">Dracula</option>
              <option value="nord">Nord</option>
              <option value="solarized">Solarized</option>
              <option value="hotdog">Hot Dog Stand</option>
            </select>
            <div className="font-controls">
              <button id="font-smaller" className="btn btn-icon" title="Decrease font size">A-</button>
              <span id="fontSize-display">13px</span>
              <button id="font-larger" className="btn btn-icon" title="Increase font size">A+</button>
            </div>
          </div>
        </div>
      </div>

      {/* <!-- ── Main content ─────────────────────────────────────────────────── --> */}
      <div id="main">

        {/* <!-- ═══ Log Viewer Tab ═══════════════════════════════════════════════ --> */}
        <div className={`tab-content { ${activeTab == 'viewer' ? 'active' : {}}`} data-tab="viewer">
          <div id="sidebar">
            <div id="quick-links">
              <div id="quick-links-header">Quick Links</div>
              <ul id="quick-links-list">
                <li id="ansible-log-link"><span className="icon">&#128280;</span><span className="name">Ansible Playbook Log</span></li>
              </ul>
            </div>
            <div id="sidebar-header">&#128193; File Browser</div>
            <div id="sidebar-path" title="">{displayCurrentPath}</div>
            <ul id="file-list" style={{ overflow: 'auto', maxHeight: `calc(100vh - 200px)` }}>
              {
                parentPath != null ?
                  <li className="parent-dir" data-path="' + ea(data.parent) + '" onClick={() => handleOpenFolder(parentPath + '\\', true)}><span className="icon">&#8593;</span><span className="name">..</span></li> :
                  null
              }
              {
                browserEntries.length > 0 ?
                  browserEntries.map((entry, i) => {
                    return entry.isDir ?
                      <li className='dir' key={i} onClick={() => handleOpenFolder(entry.name)}><span className="icon">&#128193;</span><span className='name'>{entry.name}</span></li> :
                      <li className='log-file' key={i} onClick={() => handleOpenFile(currentPath + entry.name)}><span className="icon">&#128196;</span><span className='name'>{entry.name}</span></li>
                  })
                  : <li className="loading">Loading...</li>
              }
            </ul>
          </div>
          <div id="resizer"></div>
          <div id="viewer">
            {/* <!-- Find bar (Ctrl+F) --> */}
            <div id="find-bar" className="hidden">
              <input id="find-input" type="text" placeholder="Find in log..." autoComplete="off" />
              <label className="checkbox-label"><input type="checkbox" id="find-regex-cb" /> Regex</label>
              <span id="find-count"></span>
              <button id="find-prev" className="btn btn-icon" title="Previous (Shift+F3)">&#9650;</button>
              <button id="find-next" className="btn btn-icon" title="Next (F3)">&#9660;</button>
              <button id="find-close" className="btn btn-icon" title="Close (Esc)">&#10005;</button>
            </div>
            {/* <!-- Column header (resize handles on all but last column) --> */}
            <div id="log-header" className="log-grid" style={{ display: activeTab == 'viewer' ? 'grid' : 'none' }}>
              <span className="col-time">Time<i className="col-rz" data-col="0"></i></span>
              <span className="col-date">Date<i className="col-rz" data-col="1"></i></span>
              <span className="col-comp">Component<i className="col-rz" data-col="2"></i></span>
              <span className="col-thread">Thread<i className="col-rz" data-col="3"></i></span>
              <span className="col-delta">Delta<i className="col-rz" data-col="4"></i></span>
              <span className="col-type">Type<i className="col-rz" data-col="5"></i></span>
              <span className="col-message">Message</span>
            </div>
            {/* <!-- Virtual scroll area + empty state --> */}
            <div id="log-scroll-wrap" style={{ display: allEntries.length > 0 ? 'block' : 'none' }}>
              <div id="log-scroll-inner">
                {
                  filteredEntries ?
                    filteredEntries.map((entry, idx) => {
                      return (
                        <div className={`log-row type-${entry.type ? entry.type : 1}`} style={{ top: `${idx * ROW_HEIGHT}px` }} data-idx={idx}>
                          <span className="col-time">{entry.time}</span>
                          <span className="col-date">{entry.date}</span>
                          <span className="col-comp">{entry.comp}</span>
                          <span className="col-thread">{entry.thread}</span>
                          <span className="col-delta">{ calcDelta(filteredEntries[idx - 1], entry) }</span>
                          <span className="col-type">{entry.typeName}</span>
                          <span className="col-message">{entry.message}</span>
                        </div>
                      )
                    }) :
                    {}
                }
              </div>
            </div>
            <div id="empty-state" style={{ display: allEntries.length > 0 ? 'none' : 'flex' }}>
              <span className="big">&#128196;</span>
              <span>Select a log file from the browser on the left</span>
              <span className="sub">or drag &amp; drop a file anywhere here</span>
            </div>
            {/* <!-- Detail panel --> */}
            <div id="detail-panel"></div>
          </div>
        </div>

        {/* <!-- ═══ Intune Diagnostics Tab ═══════════════════════════════════════ --> */}
        <div className={`tab-content { ${activeTab == 'intune' ? 'active' : {}}`} data-tab="intune">
          <div id="intune-wrap">
            <div id="intune-body">
              <div id="intune-sidebar">
                <div className="intune-summary-box" id="intune-summary-box" style={{ display: 'none' }}>
                  <h3>Summary</h3>
                  <div id="intune-summary-content"></div>
                </div>
                <div className="intune-summary-box" id="intune-dl-box" style={{ display: 'none' }}>
                  <h3>Downloads</h3>
                  <div id="intune-dl-content"></div>
                </div>
              </div>
              <div id="intune-timeline">
                <div className="intune-empty" id="intune-empty">
                  <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#128295;</div>
                  <div>Load an Intune Management Extension log to see a diagnostic timeline.</div>
                  <div style={{ marginTop: '8px', color: 'var(--text3)', fontSize: '12px' }}>
                    Typical path: C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\IntuneManagementExtension.log
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* <!-- ═══ DSRegCmd Tab ════════════════════════════════════════════════ --> */}
        <div className={`tab-content { ${activeTab == 'dsreg' ? 'active' : {}}`} data-tab="dsreg">
          <div id="dsreg-wrap">
            <div id="dsreg-input-panel">
              <h3>&#128187; DSRegCmd Analyzer</h3>
              <p>Paste the output of <strong>dsregcmd /status</strong> below, then click Analyze.</p>
              <p style={{ marginTop: '4px' }}>You can also load a saved .txt file using the Analyze button.</p>
              <textarea id="dsreg-textarea" placeholder="Paste dsregcmd /status output here...&#10;&#10;Example:&#10;+------...&#10;| Device State&#10;...&#10;AzureAdJoined : YES"></textarea>
              <input type="file" id="dsreg-file-input" accept=".txt,.log" style={{ display: 'none' }} />
              <button id="dsreg-load-file-btn" className="btn" style={{ marginTop: '4px' }}>&#128193; Load from file</button>
            </div>
            <div id="dsreg-results">
              <div className="dsreg-empty" id="dsreg-empty">
                Paste <code>dsregcmd /status</code> output on the left and click <strong>Analyze</strong>.
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* <!-- ── Status bar ───────────────────────────────────────────────────── --> */}
      <div id="statusbar">
        <span id="status-entries">0 entries</span>
        <span id="status-filtered"></span>
        <span id="status-watching"></span>
        <span id="status-errors"></span>
      </div>

      {/* <!-- ── Row detail modal ─────────────────────────────────────────────── --> */}
      <div id="row-modal" className="modal-overlay hidden" role="dialog" aria-modal="true">
        <div className="modal-dialog">
          <div className="modal-header">
            <span className="modal-title" id="modal-title-text">Log Entry Detail</span>
            <button className="modal-close" id="modal-close" title="Close (Esc)">&#10005;</button>
          </div>
          <div className="modal-body" id="modal-body"></div>
        </div>
      </div>

      {/* <!-- ── Channel picker modal ─────────────────────────────────────────── --> */}
      <div id="channel-modal" className="modal-overlay hidden" role="dialog" aria-modal="true">
        <div className="modal-dialog channel-modal-dialog">
          <div className="modal-header">
            <span className="modal-title">&#128221; Windows Event Channels</span>
            <button className="modal-close" id="channel-modal-close" title="Close (Esc)">&#10005;</button>
          </div>
          <div className="channel-search-wrap">
            <input id="channel-search" type="text" placeholder="Search channels..." autoComplete="off" />
          </div>
          <div id="channel-list-wrap">
            <div id="channel-list-loading" className="channel-list-msg">Loading channels...</div>
            <ul id="channel-list"></ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
