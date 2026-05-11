import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { buildTimeline, extractDownloadStats } from '../utils/intuneUtils';

const INTUNE_COL_MIN = 50;
const DEFAULT_COL_WIDTHS = [140, 90, 100];

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

const IntuneTab = forwardRef(function IntuneTab({ onFileLabelChange }, ref) {
  const [events, setEvents] = useState([]);
  const [dlStats, setDlStats] = useState([]);
  const [summary, setSummary] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [modal, setModal] = useState({ show: false, title: '', fields: [] });

  const timelineRef = useRef(null);
  const colWidthsRef = useRef(
    (() => { try { return JSON.parse(localStorage.getItem('aicm-intune-cols')) || null; } catch { return null; } })()
    || [...DEFAULT_COL_WIDTHS]
  );

  const applyColTemplate = useCallback(() => {
    const tpl = colWidthsRef.current.map(w => w + 'px').join(' ') + ' 1fr';
    document.documentElement.style.setProperty('--intune-col-template', tpl);
  }, []);

  useEffect(() => { applyColTemplate(); }, [applyColTemplate]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    let dragging = false, colIdx = -1, startX = 0, startW = 0;
    const onDown = (e) => {
      const h = e.target.closest('.intune-col-rz');
      if (!h) return;
      e.preventDefault();
      dragging = true;
      colIdx = parseInt(h.dataset.col, 10);
      startX = e.clientX;
      startW = colWidthsRef.current[colIdx];
      h.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      colWidthsRef.current[colIdx] = Math.max(INTUNE_COL_MIN, startW + (e.clientX - startX));
      applyColTemplate();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      const active = timeline.querySelector('.intune-col-rz.active');
      if (active) active.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('aicm-intune-cols', JSON.stringify(colWidthsRef.current));
    };
    const onDbl = (e) => {
      const h = e.target.closest('.intune-col-rz');
      if (h) {
        const i = parseInt(h.dataset.col, 10);
        colWidthsRef.current[i] = DEFAULT_COL_WIDTHS[i];
        applyColTemplate();
        localStorage.setItem('aicm-intune-cols', JSON.stringify(colWidthsRef.current));
      }
    };
    timeline.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    timeline.addEventListener('dblclick', onDbl);
    return () => {
      timeline.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      timeline.removeEventListener('dblclick', onDbl);
    };
  }, [applyColTemplate]);

  const processEntries = useCallback((entries) => {
    const evts = buildTimeline(entries);
    const stats = extractDownloadStats(entries);
    setEvents(evts);
    setDlStats(stats.slice(0, 10));
    const byType = {};
    let ok = 0, fail = 0;
    for (const ev of evts) {
      byType[ev.type] = (byType[ev.type] || 0) + 1;
      if (ev.status === 'Success') ok++;
      if (ev.status === 'Failed')  fail++;
    }
    setSummary(evts.length ? { total: evts.length, ok, fail, byType } : null);
  }, []);

  const loadFromFile = useCallback((file) => {
    onFileLabelChange?.(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      fetch('/api/parse', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: ev.target.result })
        .then(r => r.json())
        .then(data => processEntries(data.entries || []))
        .catch(err => { onFileLabelChange?.(`Error: ${err.message}`); });
    };
    reader.readAsText(file);
  }, [processEntries, onFileLabelChange]);

  useImperativeHandle(ref, () => ({
    openFile() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.log,.txt,.lo_';
      input.onchange = () => { if (input.files[0]) loadFromFile(input.files[0]); };
      input.click();
    },
    clear() {
      setEvents([]);
      setDlStats([]);
      setSummary(null);
      onFileLabelChange?.('No file loaded');
    },
  }), [loadFromFile, onFileLabelChange]);

  const showModal = useCallback((ev) => {
    const statusCls = ev.status === 'Failed' ? 'val-error' : ev.status === 'Success' ? 'val-info' : '';
    setModal({
      show: true,
      title: 'Intune Event Detail',
      fields: [
        { label: 'Timestamp', value: ev.ts },
        { label: 'Type',      value: ev.type },
        { label: 'Status',    value: ev.status, cls: statusCls },
        { label: 'Component', value: ev.component },
        { label: 'GUID',      value: ev.guid || '' },
        { label: 'Detail',    value: ev.detail },
      ],
    });
  }, []);

  const onDragOver  = (e) => { e.preventDefault(); setIsDragOver(true); };
  const onDragLeave = (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setIsDragOver(false); };
  const onDrop      = (e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) loadFromFile(f); };

  return (
    <div id="intune-wrap">
      <div id="intune-body">
        <div id="intune-sidebar">
          {summary && (
            <div className="intune-summary-box">
              <h3>Summary</h3>
              <div className="intune-stat"><span>Total Events</span><span className="val">{summary.total}</span></div>
              <div className="intune-stat"><span>Successes</span><span className="val ok">{summary.ok}</span></div>
              <div className="intune-stat"><span>Failures</span><span className={`val${summary.fail ? ' err' : ''}`}>{summary.fail}</span></div>
              {Object.entries(summary.byType).map(([t, n]) => (
                <div key={t} className="intune-stat"><span>{t}</span><span className="val">{n}</span></div>
              ))}
            </div>
          )}
          {dlStats.length > 0 && (
            <div className="intune-summary-box">
              <h3>Downloads</h3>
              {dlStats.map((s, i) => (
                <div key={i} className="intune-stat" style={{ flexDirection: 'column', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: '4px', marginBottom: '4px' }}>
                  {s.size   && <div>&#128190; Size: <span className="val">{s.size}</span></div>}
                  {s.speed  && <div>&#9889; Speed: <span className="val">{s.speed}</span></div>}
                  {s.do_pct && <div>&#128260; DO: <span className="val">{s.do_pct}</span></div>}
                  <div style={{ color: 'var(--text3)', fontSize: '11px', marginTop: '2px' }}>{s.msg}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div id="intune-timeline" ref={timelineRef}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          style={isDragOver ? { outline: '2px dashed var(--accent)', outlineOffset: '-4px' } : {}}>
          {events.length === 0 ? (
            <div className="intune-empty">
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>&#128295;</div>
              <div>Load an Intune Management Extension log to see a diagnostic timeline.</div>
              <div style={{ marginTop: '8px', color: 'var(--text3)', fontSize: '12px' }}>
                Typical path: C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\IntuneManagementExtension.log
              </div>
            </div>
          ) : (
            <>
              <div className="intune-event-header">
                <span>Timestamp<i className="col-rz intune-col-rz" data-col="0"></i></span>
                <span>Type<i className="col-rz intune-col-rz" data-col="1"></i></span>
                <span>Status<i className="col-rz intune-col-rz" data-col="2"></i></span>
                <span>Detail</span>
              </div>
              {events.map((ev, idx) => {
                const statusClass = ev.status === 'Success' ? 'ev-status-ok' :
                                    ev.status === 'Failed'  ? 'ev-status-fail' :
                                    ev.status === 'InProgress' ? 'ev-status-prog' : 'ev-status-unk';
                const rowClass = ev.status === 'Success' ? 'ev-success' :
                                 ev.status === 'Failed'  ? 'ev-failed'  :
                                 ev.status === 'InProgress' ? 'ev-inprogress' : 'ev-unknown';
                return (
                  <div key={idx} className={`intune-event ${rowClass}`} title="Double-click for details"
                    onDoubleClick={() => showModal(ev)}>
                    <span className="ev-ts">{ev.ts}</span>
                    <span className="ev-type">{ev.type}</span>
                    <span className={statusClass}>{ev.status}</span>
                    <span className="ev-detail">{ev.detail}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <FieldsModal show={modal.show} title={modal.title} fields={modal.fields}
        onClose={() => setModal(m => ({ ...m, show: false }))} />
    </div>
  );
});

export default IntuneTab;
