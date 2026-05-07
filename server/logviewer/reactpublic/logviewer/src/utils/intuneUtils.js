const INTUNE_PATTERNS = [
  {
    type: 'Win32App',
    startRe: /installing app|win32app.*policy|enforcement.*app|start.*install.*app/i,
    successRe: /successfully installed|install.*exit code.*\b0\b|installation succeeded|detected.*present/i,
    failRe: /failed.*install|install.*failed|installation failed|exit code.*[^0 ]/i,
  },
  {
    type: 'WinGet',
    startRe: /winget|wingetapp|windows package manager.*install/i,
    successRe: /winget.*success|winget.*completed|wingetapp.*installed/i,
    failRe: /winget.*fail|wingetapp.*failed/i,
  },
  {
    type: 'PowerShellScript',
    startRe: /script.*execut|executing.*script|running.*\.ps1|agentexecutor.*script/i,
    successRe: /script.*exit code.*\b0\b|script.*success|script.*completed.*result.*true/i,
    failRe: /script.*failed|script.*exit code.*[^0 ]|script.*exception/i,
  },
  {
    type: 'Remediation',
    startRe: /remediation|health.*script|detection script.*execut/i,
    successRe: /remediation.*success|compliant|remediated/i,
    failRe: /remediation.*fail|non.?compliant|detection.*fail/i,
  },
  {
    type: 'ESP',
    startRe: /enrollment status page|esp.*phase|esp.*start/i,
    successRe: /esp.*complete|esp.*success/i,
    failRe: /esp.*fail|esp.*timeout/i,
  },
  {
    type: 'SyncSession',
    startRe: /sync.*session.*start|device.*sync.*start|starting.*sync/i,
    successRe: /sync.*session.*end|sync.*success|sync.*completed/i,
    failRe: /sync.*failed|sync.*error/i,
  },
  {
    type: 'ContentDownload',
    startRe: /download(ing)? content|download(ing)? app|start.*download/i,
    successRe: /download.*completed|downloaded.*successfully/i,
    failRe: /download.*failed|download.*error/i,
  },
];

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SIZE_RE  = /(\d+(?:\.\d+)?)\s*(kb|mb|gb|bytes?)\b/i;
const SPEED_RE = /(\d+(?:\.\d+)?)\s*(kb\/s|mb\/s|kbps|mbps)/i;
const DO_RE    = /delivery optim\w+.*?(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*%.*delivery optim/i;

export function classifyEntry(entry) {
  const msg  = (entry.message  || '').toLowerCase();
  const comp = (entry.component || '').toLowerCase();
  const combined = comp + ' ' + msg;
  for (const p of INTUNE_PATTERNS) {
    const isStart   = p.startRe.test(combined);
    const isSuccess = p.successRe.test(combined);
    const isFail    = p.failRe.test(combined);
    if (isStart || isSuccess || isFail) {
      let status = 'Unknown';
      if (isSuccess)    status = 'Success';
      else if (isFail)  status = 'Failed';
      else if (isStart) status = 'InProgress';
      const gm = GUID_RE.exec(entry.message || '');
      return { type: p.type, status, guid: gm ? gm[0] : null };
    }
  }
  return null;
}

export function extractDownloadStats(entries) {
  const stats = [];
  for (const e of entries) {
    const m = e.message || '';
    const sizem  = SIZE_RE.exec(m);
    const speedm = SPEED_RE.exec(m);
    const dom    = DO_RE.exec(m);
    if (sizem || speedm || dom) {
      stats.push({
        ts:     (e.date || '') + ' ' + (e.time || ''),
        size:   sizem  ? sizem[1]  + ' ' + sizem[2]  : null,
        speed:  speedm ? speedm[1] + ' ' + speedm[2] : null,
        do_pct: dom    ? (dom[1] || dom[2]) + '%'    : null,
        msg:    m.length > 120 ? m.slice(0, 120) + '...' : m,
      });
    }
  }
  return stats.slice(0, 30);
}

export function buildTimeline(entries) {
  return entries.reduce((events, entry) => {
    const cls = classifyEntry(entry);
    if (cls) {
      events.push({
        type:      cls.type,
        status:    cls.status,
        guid:      cls.guid,
        ts:        (entry.date || '') + ' ' + (entry.time || ''),
        detail:    entry.message || '',
        component: entry.component || '',
      });
    }
    return events;
  }, []);
}
