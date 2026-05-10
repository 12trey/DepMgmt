'use strict';

const fs = require('fs');
const http = require('http');
const chokidar = require('chokidar');
const { parseContent } = require('./logParser');
const { readChannelSince } = require('./evtxParser');

const CHANNEL_POLL_MS  = 2000;
const CHANNEL_BATCH    = 2000; // max events per poll; if full → catch-up immediately
const ANSIBLE_POLL_MS = 3000;
const ANSIBLE_LOG_URL = 'http://localhost:7000/logs/cmtrace';

module.exports = function attachTailWatcher(io) {
  // Per-socket state
  const watchers = new Map();

  function clearState(state) {
    if (state.watcher) { state.watcher.close(); state.watcher = null; }
    if (state.timer)   { clearInterval(state.timer); state.timer = null; }
    state.filePath    = null;
    state.channelName = null;
    state.offset      = 0;
    state.sinceIso    = null;
  }

  io.on('connection', socket => {
    watchers.set(socket.id, { watcher: null, timer: null, filePath: null, channelName: null, offset: 0, sinceIso: null });

    // ── File tail ─────────────────────────────────────────────────────────
    socket.on('watch', ({ path: filePath }) => {
      const state = watchers.get(socket.id);
      if (!state) return;
      clearState(state);

      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) return;
        state.filePath = filePath;
        state.offset   = stat.size;

        const watcher = chokidar.watch(filePath, {
          persistent: true,
          usePolling: false,
          awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
        });

        watcher.on('change', changedPath => {
          try {
            const newStat = fs.statSync(changedPath);
            if (newStat.size <= state.offset) state.offset = 0;
            if (newStat.size === state.offset) return;

            const chunks = [];
            const stream = fs.createReadStream(changedPath, {
              start: state.offset,
              end: newStat.size - 1,
              encoding: 'utf8'
            });
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => {
              state.offset = newStat.size;
              const newContent = chunks.join('');
              if (!newContent.trim()) return;
              const entries = parseContent(newContent);
              if (entries.length) socket.emit('log:lines', { entries });
            });
            stream.on('error', () => {});
          } catch (_) {}
        });

        state.watcher = watcher;
      } catch (err) {
        socket.emit('error', { message: 'Cannot watch file: ' + err.message });
      }
    });

    // ── Live channel polling ──────────────────────────────────────────────
    socket.on('watch:channel', ({ channel, since, remote, username, password }) => {
      const state = watchers.get(socket.id);
      if (!state) return;
      clearState(state);

      state.channelName = channel;
      state.sinceIso    = since || new Date().toISOString();
      state.remoteOpts  = remote ? { remote, username, password } : {};

      // Use setTimeout chaining so the next poll only starts after the
      // previous wevtutil call completes — prevents concurrent calls piling
      // up on slow networks. First poll fires immediately.
      async function poll() {
        if (state.channelName !== channel) return;
        let delay = CHANNEL_POLL_MS;
        try {
          const entries = await readChannelSince(state.channelName, state.sinceIso, state.remoteOpts, CHANNEL_BATCH);
          if (entries.length) {
            const last = entries[entries.length - 1];
            if (last.isoTime) state.sinceIso = last.isoTime;
            socket.emit('log:lines', { entries });
            // Batch was full — there are likely more events waiting; catch up immediately
            if (entries.length >= CHANNEL_BATCH) delay = 0;
          }
        } catch (_) {}
        if (state.channelName === channel) {
          state.timer = setTimeout(poll, delay);
        }
      }

      poll();
    });

    // ── Ansible playbook log polling ──────────────────────────────────────
    socket.on('watch:ansible', () => {
      const state = watchers.get(socket.id);
      if (!state) return;
      clearState(state);

      state.channelName = 'ansible'; // marks this slot as an ansible watcher
      state.offset = 0;

      function fetchAnsibleChunk() {
        const url = ANSIBLE_LOG_URL + '?offset=' + state.offset;
        http.get(url, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (!text.trim()) return;
            state.offset += Buffer.byteLength(text, 'utf8');
            const entries = parseContent(text);
            if (entries.length) socket.emit('log:lines', { entries });
          });
        }).on('error', () => {});
      }

      // Immediately emit existing content, then poll for new lines
      fetchAnsibleChunk();
      state.timer = setInterval(fetchAnsibleChunk, ANSIBLE_POLL_MS);
    });

    // ── Stop watching ─────────────────────────────────────────────────────
    socket.on('unwatch', () => {
      const state = watchers.get(socket.id);
      if (state) clearState(state);
    });

    socket.on('disconnect', () => {
      const state = watchers.get(socket.id);
      if (state) clearState(state);
      watchers.delete(socket.id);
    });
  });
};
