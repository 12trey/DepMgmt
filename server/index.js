const express = require('express');
const cors = require('cors');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const paths = require('./paths');

const packageRoutes = require('./routes/packages');
const executionRoutes = require('./routes/execution');
const gitRoutes = require('./routes/git');
const configRoutes = require('./routes/config');
const msiRoutes = require('./routes/msi');
const intuneRoutes = require('./routes/intune');
const groupRoutes = require('./routes/groups');
const wslRoutes = require('./routes/wsl');
const psadtRoutes = require('./routes/psadt');
const signRoutes = require('./routes/sign');
const scriptRoutes = require('./routes/scripts');
const templateRoutes = require('./routes/templates');
const vscodeRoutes  = require('./routes/vscode');
const setupLogViewer = require('./logviewer');
const { attachWss } = require('./services/logStream');
const { attachTerminalWss } = wslRoutes;

const app = express();
const server = http.createServer(app);

// Both WSS instances use noServer:true — manual upgrade routing avoids the ws
// library bug where the first instance calls abortHandshake() on unrecognised
// paths, destroying the socket before the second instance can claim it.
const wss = new WebSocketServer({ noServer: true });
attachWss(wss);

const terminalWss = new WebSocketServer({ noServer: true });
attachTerminalWss(terminalWss);

server.on('upgrade', (req, socket, head) => {
  const pathname = req.url.split('?')[0];
  if (pathname === '/ws/logs') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/ws/terminal') {
    terminalWss.handleUpgrade(req, socket, head, (ws) => terminalWss.emit('connection', ws, req));
  } else if (!pathname.startsWith('/socket.io')) {
    // Socket.IO handles its own /socket.io/* upgrades via its own listener
    socket.destroy();
  }
});

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/packages', packageRoutes);
app.use('/api/execution', executionRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/config', configRoutes);
app.use('/api/msi', msiRoutes);
app.use('/api/intune', intuneRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/wsl', wslRoutes);
app.use('/api/psadt', psadtRoutes);
app.use('/api/sign', signRoutes);
app.use('/api/scripts', scriptRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/vscode', vscodeRoutes);

// Log Viewer (AICMTrace integration) — must be before the React catch-all
setupLogViewer(app, server);

// Serve React build in production
if (fs.existsSync(paths.clientDist)) {
  app.use(express.static(paths.clientDist));
  app.get('*', (_req, res) => res.sendFile('index.html', { root: paths.clientDist }));
}

const config = JSON.parse(fs.readFileSync(paths.configPath, 'utf-8'));
const PORT = process.env.PORT || config.server.port || 4000;

// Export a promise so Electron's main process can await actual readiness
module.exports = new Promise((resolve, reject) => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (process.send) process.send('ready'); // notify Electron main process when forked
    resolve(PORT);
  });
  server.on('error', reject);
});
