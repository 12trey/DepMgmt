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
const { attachWss } = require('./services/logStream');

const app = express();
const server = http.createServer(app);

// WebSocket server for log streaming
const wss = new WebSocketServer({ server, path: '/ws/logs' });
attachWss(wss);

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/packages', packageRoutes);
app.use('/api/execution', executionRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/config', configRoutes);
app.use('/api/msi', msiRoutes);

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
