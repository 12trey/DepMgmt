const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const { session } = require('electron');
const { electron } = require('process');

const LOG_PATH = path.join(process.env.USERPROFILE || 'C:\\', 'aipsadt-startup.log');
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  fs.appendFileSync(LOG_PATH, line);
}

// Enforce single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow;
let serverProcess;

const isDev = process.env.NODE_ENV === 'development';
const SERVER_PORT = 4000;


function createWindow() {
  mainWindow = new BrowserWindow({
    // titleBarStyle: 'hidden',
    // titleBarOverlay: {
    //   color: '#2f3241',
    //   symbolColor: '#74c1ff',
    //   height: 30
    // },
    width: 1280,
    height: 860,
    show: false,
    icon: path.join(__dirname, 'build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    },
  });

  ipcMain.on('iframe-message', (event, data) => {
    console.log('Received from iframe:', data);
    clipboard.writeText(data);

    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Clipboard Updated',
      message: `${data}\nwas copied to clipboard. Paste and execute in an elevated terminal to run.`,
      buttons: ['OK']
    });
    // send back to renderer
    event.sender.send('clipboard-updated', data);
    //console.log(clipboard.readText());
  });
  
  mainWindow.removeMenu();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error(`Page failed to load: ${desc} (${code})`);
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '../server/index.js');
    serverProcess = fork(serverPath, [], {
      env: { ...process.env, PORT: String(SERVER_PORT), NODE_ENV: 'production' },
    });
    serverProcess.once('message', (msg) => {
      if (msg === 'ready') resolve();
    });
    serverProcess.once('error', reject);
    setTimeout(() => reject(new Error('Server startup timed out')), 30000);
  });
}

ipcMain.handle('pick-folder', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('pick-file', async (_event, options = {}) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: options.filters || [],
  });
  return result.canceled ? null : result.filePaths[0];
});

app.whenReady().then(async () => {
  log(`[startup] app ready, isDev=${isDev}`);
  if (!isDev) {
    log('[startup] forking server...');
    const t = Date.now();
    try {
      await startServer();
    } catch (err) {
      log(`[startup] server error: ${err.message}`);
    }
    log(`[startup] server ready in ${Date.now() - t}ms`);
    const t2 = Date.now();

    createWindow();
    mainWindow.once('ready-to-show', () => {
      log(`[startup] main window ready in ${Date.now() - t2}ms`);
      // Keep logging until we confirm fork is stable, then remove
    });
  } else {
    createWindow();
  }

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'clipboard-write') {
      callback(true);
    } else {
      callback(false);
    }
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) serverProcess.kill();
  app.quit();
});
