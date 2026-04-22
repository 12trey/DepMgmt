'use strict';

const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { router: browserRouter } = require('./fileBrowser');
const { router: parserRouter } = require('./logParser');
const { router: evtxRouter } = require('./evtxParser');
const attachTailWatcher = require('./tailWatcher');

module.exports = function setupLogViewer(app, httpServer) {
  const io = new Server(httpServer, {
    cors: false,
    // Use default /socket.io path — compatible with the auto-served client bundle
  });

  // Parse raw text bodies for the /api/parse endpoint
  app.use(express.text({ limit: '100mb', type: 'text/*' }));

  // AICMTrace API routes (file browser, log parser, evtx parser)
  app.use(browserRouter);
  app.use(parserRouter);
  app.use(evtxRouter);

  // Serve the Log Viewer static frontend under /logviewer
  app.use('/logviewer', express.static(path.join(__dirname, 'public')));

  // Attach real-time tail watcher (file tail + channel polling + ansible polling)
  attachTailWatcher(io);
};
