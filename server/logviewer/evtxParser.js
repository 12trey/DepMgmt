'use strict';

const { execFile } = require('child_process');
const { Router } = require('express');

const WEVTUTIL   = 'wevtutil.exe';
const MAX_BUF    = 50 * 1024 * 1024; // 50 MB
const LOAD_LIMIT = 50_000;           // max events fetched from wevtutil per source
const CACHE_MAX  = 5;                // max concurrent sources kept in memory
const CACHE_TTL  = 5 * 60 * 1000;   // 5 minutes before a cached source is stale

// ── Server-side event cache (LRU by last-access) ──────────────────────────
const eventCache = new Map(); // key → { entries, ts }

function _cacheKey({ filePath, channel, remote }) {
  return JSON.stringify({ f: filePath || null, c: channel || null, r: remote || null });
}

function cacheGet(key) {
  const hit = eventCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL) { eventCache.delete(key); return null; }
  eventCache.delete(key);           // move to end (LRU)
  eventCache.set(key, hit);
  return hit.entries;
}

function cacheSet(key, entries) {
  if (eventCache.size >= CACHE_MAX) {
    eventCache.delete(eventCache.keys().next().value); // evict oldest
  }
  eventCache.set(key, { entries, ts: Date.now() });
}

// ── Server-side filter (mirrors client makeFilter) ─────────────────────────
function filterEntries(entries, level, text, isRegex) {
  if (!level && !text) return entries;
  return entries.filter(e => {
    if (level > 0 && e.type !== level) return false;
    if (!text) return true;
    if (isRegex) {
      try {
        const re = new RegExp(text, 'i');
        return re.test(e.message || '') || re.test(e.component || '');
      } catch { return false; }
    }
    const low = text.toLowerCase();
    return (e.message || '').toLowerCase().includes(low) ||
           (e.component || '').toLowerCase().includes(low);
  });
}

// ── Parse wevtutil RenderedXml output ──────────────────────────────────────
// /f:RenderedXml gives the full-precision SystemTime attribute (7 decimal
// places = 100 ns resolution) from the event's XML. /f:text truncates to
// milliseconds and pads with zeros, so "25.2568953Z" appears as "25.2560000Z".
// That truncation meant @SystemTime > 'padded-value' kept returning the same
// events on every poll because their real SystemTime was above the padded floor.
function unescapeXml(s) {
  return s
    .replace(/&#x0?D;&#x0?A;/gi, '\n')
    .replace(/&#x0?A;/gi, '\n')
    .replace(/&#x0?D;/gi, '\r')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/<[^>]+>/g, '');  // strip any remaining inline XML tags
}

function parseWevtutilRenderedXml(text) {
  if (!text || !text.trim()) return [];
  const entries = [];
  const blocks = text.split(/<\/Event>/i);
  for (const block of blocks) {
    const entry = parseRenderedXmlBlock(block);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseRenderedXmlBlock(block) {
  if (!block.trim() || !/<Event\b/i.test(block)) return null;

  // Full-precision SystemTime — wevtutil uses single-quoted attributes in its XML
  const stMatch = block.match(/\bSystemTime=['"]([^'"]+)['"]/i);
  if (!stMatch) return null;
  const isoTime = stMatch[1];

  // Convert UTC SystemTime to server-local time for display (isoTime stays UTC for XPath)
  let date = '', time = '';
  try {
    const d = new Date(isoTime);
    if (!isNaN(d)) {
      const p = n => String(n).padStart(2, '0');
      date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
  } catch (_) {}

  const eidMatch = block.match(/<EventID(?:\s[^>]*)?>(\d+)<\/EventID>/i);
  const eventId = eidMatch ? eidMatch[1] : '';

  const chanMatch = block.match(/<Channel>([^<]+)<\/Channel>/i);
  const channel = chanMatch ? chanMatch[1].trim() : '';

  const compMatch = block.match(/<Computer>([^<]+)<\/Computer>/i);
  const computer = compMatch ? compMatch[1].trim() : '';

  // Provider Name attribute
  const provMatch = block.match(/<Provider\b[^>]*\bName=['"]([^'"]+)['"]/i);
  const component = provMatch ? provMatch[1] : '';

  // User SID
  const userMatch = block.match(/<Security\b[^>]*\bUserID=['"]([^'"]+)['"]/i);
  const user = userMatch ? userMatch[1] : '';

  // RenderingInfo contains the rendered level string and human-readable message
  const riMatch = block.match(/<RenderingInfo\b[^>]*>([\s\S]*?)<\/RenderingInfo>/i);
  let levelStr = 'Information';
  let message = '';
  let taskStr = '';
  let keywords = '';

  if (riMatch) {
    const ri = riMatch[1];
    const lvlM = ri.match(/<Level>([^<]*)<\/Level>/i);
    if (lvlM && lvlM[1].trim()) levelStr = lvlM[1].trim();
    const taskM = ri.match(/<Task>([^<]*)<\/Task>/i);
    if (taskM) taskStr = taskM[1].trim();
    const msgM = ri.match(/<Message>([\s\S]*?)<\/Message>/i);
    if (msgM) message = unescapeXml(msgM[1]).trim();
    const kwM = ri.match(/<Keywords>([\s\S]*?)<\/Keywords>/i);
    if (kwM) keywords = unescapeXml(kwM[1]).replace(/\s+/g, ' ').trim();
  } else {
    // Fallback when RenderingInfo is absent: derive level from numeric System/Level
    const lvlNumM = block.match(/<Level>(\d+)<\/Level>/i);
    const n = lvlNumM ? parseInt(lvlNumM[1], 10) : 4;
    if (n === 1) levelStr = 'Critical';
    else if (n === 2) levelStr = 'Error';
    else if (n === 3) levelStr = 'Warning';
    else if (n === 5) levelStr = 'Verbose';
  }

  let type = 1;
  if (levelStr === 'Error' || levelStr === 'Critical') type = 3;
  else if (levelStr === 'Warning') type = 2;

  const raw = `Date: ${isoTime}\nSource: ${component}\nEvent ID: ${eventId}\nLevel: ${levelStr}\n\n${message}`;

  return {
    message,
    time,
    date,
    component,
    thread   : taskStr,
    type,
    typeName : levelStr,
    file     : '',
    format   : 'evtx',
    raw,
    isoTime,
    eventId,
    channel,
    computer,
    user,
    keywords,
  };
}

// ── wevtutil runners ───────────────────────────────────────────────────────
function run(args, { remote, username, password } = {}) {
  const fullArgs = [...args];
  if (remote)   fullArgs.push('/r:' + remote);
  if (username) fullArgs.push('/u:' + username);
  if (password) fullArgs.push('/p:' + password);
  return new Promise((resolve, reject) => {
    execFile(WEVTUTIL, fullArgs, { maxBuffer: MAX_BUF, windowsHide: true, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err && err.code === 5)
          return reject(Object.assign(new Error('Access denied (run as admin for Security log)'), { code: 'EACCES' }));
        if (err && !stdout)
          return reject(new Error((stderr || err.message).trim().replace(/\0/g, '')));
        // Strip null bytes that appear when wevtutil outputs UTF-16 read as UTF-8
        resolve((stdout || '').replace(/\0/g, ''));
      });
  });
}

// Read last N events from an .evtx file (chronological order)
async function readEvtxFile(filePath, count = 1000, remoteOpts = {}) {
  const out = await run(['qe', filePath, '/lf:true', '/f:RenderedXml', '/rd:true', '/c:' + count], remoteOpts);
  return parseWevtutilRenderedXml(out).reverse();
}

// Read last N events from a named channel (chronological order)
async function readChannel(channelName, count = 1000, remoteOpts = {}) {
  const out = await run(['qe', channelName, '/f:RenderedXml', '/rd:true', '/c:' + count], remoteOpts);
  return parseWevtutilRenderedXml(out).reverse();
}

// Read events newer than sinceIso from a named channel
async function readChannelSince(channelName, sinceIso, remoteOpts = {}, count = 2000) {
  const xpath = `*[System[TimeCreated[@SystemTime>'${sinceIso}']]]`;
  const out = await run(['qe', channelName, '/f:RenderedXml', '/q:' + xpath, '/c:' + count], remoteOpts);
  return parseWevtutilRenderedXml(out); // already oldest-first without /rd
}

// List all available channels
async function listChannels(remoteOpts = {}) {
  const out = await run(['el'], remoteOpts);
  return out.split(/\r?\n/).map(l => l.trim()).filter(Boolean).sort();
}

// ── Express routes ─────────────────────────────────────────────────────────
const router = Router();

router.get('/api/evtx', async (req, res) => {
  const {
    path: filePath, channel, offset: offsetStr, count: countStr, ps: psStr,
    remote, username, password, level: levelStr, text, regex: regexStr,
  } = req.query;

  const remoteOpts = remote ? { remote, username, password } : {};
  const ck = _cacheKey({ filePath, channel, remote });

  try {
    let all = cacheGet(ck);
    if (!all) {
      if (filePath)     all = await readEvtxFile(filePath, LOAD_LIMIT, remoteOpts);
      else if (channel) all = await readChannel(channel, LOAD_LIMIT, remoteOpts);
      else return res.status(400).json({ error: 'path or channel parameter required' });
      cacheSet(ck, all);
    }

    const rawTotal    = all.length;
    const errCount    = all.reduce((n, e) => n + (e.type === 3 ? 1 : 0), 0);
    const warnCount   = all.reduce((n, e) => n + (e.type === 2 ? 1 : 0), 0);
    const sinceIsoTime = all.length ? (all[all.length - 1].isoTime || '') : '';

    const level    = parseInt(levelStr, 10) || 0;
    const filtered = filterEntries(all, level, text || '', regexStr === 'true');
    const total    = filtered.length;

    // Page size sent by client so offsets can be snapped to page boundaries
    const ps    = Math.max(1, parseInt(psStr, 10) || 50);
    const count = Math.max(1, parseInt(countStr, 10) || ps * 3);

    let offset;
    if (offsetStr === 'end') {
      // Return last N pages worth of data
      const startPage = Math.max(0, Math.ceil(total / ps) - Math.ceil(count / ps));
      offset = startPage * ps;
    } else {
      // Snap arbitrary offset to its page boundary
      const raw = Math.max(0, parseInt(offsetStr, 10) || 0);
      offset = Math.floor(raw / ps) * ps;
    }

    res.json({
      total, rawTotal, errCount, warnCount, sinceIsoTime,
      offset,
      entries: filtered.slice(offset, offset + count),
    });
  } catch (err) {
    const status = err.code === 'EACCES' ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

// Full-text search across cached entries (used by the Find bar in paged mode)
router.get('/api/evtx/search', async (req, res) => {
  const {
    path: filePath, channel, remote, username, password,
    level: levelStr, text: filterText, regex: filterRegexStr,
    find: findText, findRegex: findRegexStr,
  } = req.query;

  const remoteOpts = remote ? { remote, username, password } : {};
  const ck = _cacheKey({ filePath, channel, remote });

  const all = cacheGet(ck);
  if (!all) return res.status(404).json({ error: 'Data not loaded — open the log first.' });

  const level    = parseInt(levelStr, 10) || 0;
  const filtered = filterEntries(all, level, filterText || '', filterRegexStr === 'true');

  const needle  = findText || '';
  const isRegex = findRegexStr === 'true';
  const matches = [];

  if (needle) {
    let re;
    if (isRegex) { try { re = new RegExp(needle, 'i'); } catch { re = null; } }
    filtered.forEach((e, i) => {
      const msg  = e.message   || '';
      const comp = e.component || '';
      const hit = re
        ? (re.test(msg) || re.test(comp))
        : (msg.toLowerCase().includes(needle.toLowerCase()) ||
           comp.toLowerCase().includes(needle.toLowerCase()));
      if (hit) matches.push(i);
    });
  }

  res.json({ matches });
});

router.get('/api/evtx/channels', async (req, res) => {
  const { remote, username, password } = req.query;
  const remoteOpts = remote ? { remote, username, password } : {};
  try {
    const channels = await listChannels(remoteOpts);
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, readChannelSince };
