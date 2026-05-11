import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { parseDsreg, buildFacts, analyzeIssues } from '../utils/dsregUtils';

const DSREG_COL_MIN = 80;

function FieldsModal({ show, title, fields, onClose }) {
  useEffect(() => {
    if (!show) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [show, onClose]);

  if (!show) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog">
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" title="Close (Esc)" onClick={onClose}>&#10005;</button>
        </div>
        <div className="modal-body">
          {fields.filter(f => f.value).map((f, i) => (
            <div key={i}>
              <div className="modal-field-label">{f.label}</div>
              <div className={`modal-field-value${f.cls ? ' ' + f.cls : ''}`}>{f.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const DsregTab = forwardRef(function DsregTab(_props, ref) {
  const [text, setText] = useState('');
  const [sections, setSections] = useState([]);
  const [issues, setIssues] = useState([]);
  const [analyzed, setAnalyzed] = useState(false);
  const [modal, setModal] = useState({ show: false, title: '', fields: [] });

  const resultsRef   = useRef(null);
  const fileInputRef = useRef(null);
  const keyWidth     = useRef((() => { const v = parseInt(localStorage.getItem('aicm-dsreg-key'), 10); return isNaN(v) ? 200 : v; })());

  const applyKW = useCallback(() => {
    document.documentElement.style.setProperty('--dsreg-key-width', keyWidth.current + 'px');
  }, []);

  useEffect(() => { applyKW(); }, [applyKW]);

  // Column resize
  useEffect(() => {
    const resultsEl = resultsRef.current;
    if (!resultsEl) return;
    let dragging = false, startX = 0, startW = 0;
    const onDown = (e) => {
      const h = e.target.closest('.dsreg-col-rz');
      if (!h) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startW = keyWidth.current;
      h.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      keyWidth.current = Math.max(DSREG_COL_MIN, startW + (e.clientX - startX));
      applyKW();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const active = resultsEl.querySelector('.dsreg-col-rz.active');
      if (active) active.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('aicm-dsreg-key', String(keyWidth.current));
    };
    const onDbl = (e) => {
      if (e.target.closest('.dsreg-col-rz')) {
        keyWidth.current = 200;
        applyKW();
        localStorage.setItem('aicm-dsreg-key', '200');
        return;
      }
      const kv = e.target.closest('.dsreg-kv');
      if (kv) {
        setModal({ show: true, title: 'DSReg Field', fields: [
          { label: 'Key',   value: kv.dataset.key  || '' },
          { label: 'Value', value: kv.dataset.val  || '' },
        ]});
        return;
      }
      const issue = e.target.closest('[data-issue]');
      if (issue) {
        setModal({ show: true, title: 'Diagnostic Issue', fields: [
          { label: 'Severity',       value: issue.dataset.sev   || '' },
          { label: 'Title',          value: issue.dataset.title || '' },
          { label: 'Description',    value: issue.dataset.desc  || '' },
          { label: 'Recommendation', value: issue.dataset.fix   || '' },
        ]});
      }
    };
    resultsEl.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    resultsEl.addEventListener('dblclick', onDbl);
    return () => {
      resultsEl.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      resultsEl.removeEventListener('dblclick', onDbl);
    };
  }, [applyKW]);

  const runAnalysis = useCallback((txt) => {
    if (!txt.trim()) { setSections([]); setIssues([]); setAnalyzed(true); return; }
    const secs = parseDsreg(txt);
    if (!secs.length) { setSections([]); setIssues([]); setAnalyzed(true); return; }
    const facts = buildFacts(secs);
    setSections(secs);
    setIssues(analyzeIssues(facts));
    setAnalyzed(true);
  }, []);

  useImperativeHandle(ref, () => ({
    analyze() { runAnalysis(text); },
    clear() {
      setText('');
      setSections([]);
      setIssues([]);
      setAnalyzed(false);
    },
  }), [runAnalysis, text]);

  const handleKeyDown = (e) => {
    if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runAnalysis(text); }
  };

  const handleLoadFile = () => { fileInputRef.current?.click(); };
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { const t = ev.target.result; setText(t); runAnalysis(t); };
    reader.readAsText(file);
    e.target.value = '';
  };

  const sevIcon = (sev) => sev === 'error' ? '❌ ' : sev === 'warning' ? '⚠ ' : 'ℹ ';

  return (
    <div id="dsreg-wrap">
      <div id="dsreg-input-panel">
        <h3>&#128187; DSRegCmd Analyzer</h3>
        <p>Paste the output of <strong>dsregcmd /status</strong> below, then click Analyze.</p>
        <p style={{ marginTop: '4px' }}>You can also load a saved .txt file using the button below.</p>
        <textarea
          id="dsreg-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={"Paste dsregcmd /status output here...\n\nExample:\n+------...\n| Device State\n...\nAzureAdJoined : YES"}
        />
        <input ref={fileInputRef} type="file" accept=".txt,.log" style={{ display: 'none' }} onChange={handleFileChange} />
        <button className="btn" style={{ marginTop: '4px' }} onClick={handleLoadFile}>&#128193; Load from file</button>
      </div>

      <div id="dsreg-results" ref={resultsRef}>
        {!analyzed ? (
          <div className="dsreg-empty">
            Paste <code>dsregcmd /status</code> output on the left and click <strong>Analyze</strong>.
          </div>
        ) : !sections.length ? (
          <div className="dsreg-empty">
            {text.trim()
              ? 'Could not parse the input. Make sure you pasted the full output of dsregcmd /status.'
              : 'Nothing to analyze. Paste dsregcmd /status output on the left.'}
          </div>
        ) : (
          <>
            <div className="dsreg-col-header">
              <span>Key</span>
              <i className="dsreg-col-rz" title="Drag to resize"></i>
              <span>Value</span>
            </div>

            {issues.length > 0 && (
              <div className="dsreg-section">
                <div className="dsreg-section-title">&#128270; Diagnostic Issues ({issues.length})</div>
                <ul className="dsreg-issues">
                  {issues.map((issue, i) => (
                    <li key={i} className={`dsreg-issue sev-${issue.sev}`}
                      data-issue="true"
                      data-sev={issue.sev} data-title={issue.title}
                      data-desc={issue.desc} data-fix={issue.fix}
                      title="Double-click for full detail">
                      <div className={`dsreg-issue-title sev-${issue.sev}`}>{sevIcon(issue.sev)}{issue.title}</div>
                      <div className="dsreg-issue-desc">{issue.desc}</div>
                      <div className="dsreg-issue-fix">&#128161; {issue.fix}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sections.filter(s => s.pairs.length > 0).map((section, si) => (
              <div key={si} className="dsreg-section">
                <div className="dsreg-section-title">{section.title}</div>
                {section.pairs.map((p, pi) => {
                  const val = p.value;
                  const valClass = /^YES$/i.test(val) ? 'val-yes' :
                                   /^NO$/i.test(val)  ? 'val-no'  :
                                   (!val || val === 'N/A' || val === '-') ? 'val-empty' : '';
                  const displayVal = (!val || val === 'N/A' || val === '-') ? (val || '(empty)') : val;
                  return (
                    <div key={pi} className="dsreg-kv" data-key={p.key} data-val={p.value} title="Double-click to expand">
                      <span className="dsreg-key">{p.key}</span>
                      <span className="dsreg-spacer"></span>
                      <span className={`dsreg-val${valClass ? ' ' + valClass : ''}`}>{displayVal}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>

      <FieldsModal show={modal.show} title={modal.title} fields={modal.fields}
        onClose={() => setModal(m => ({ ...m, show: false }))} />
    </div>
  );
});

export default DsregTab;
