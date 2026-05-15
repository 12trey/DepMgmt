const { app, BrowserWindow, ipcMain, dialog, clipboard, Menu, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { fork, spawn } = require('child_process');
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

function checkExecutable(exe) {
  // Get the system path and split it by the platform delimiter
  const pathDirs = (process.env.PATH || "").split(path.delimiter);

  // Windows uses PATHEXT to resolve extensions automatically if not provided
  const extensions = (process.env.PATHEXT || ".EXE").split(';');

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, exe + ext);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

const openPsadtReference = () => {
  // const child = spawn('powershell.exe', ['-NoExit',
  //   '-ExecutionPolicy', 'Bypass', '-c', 'Show-ADTHelpConsole;'], {
  //   detached: true,
  //   shell: true,
  //   stdio: 'ignore'
  // });

  // child.unref();

  const pwshPath = checkExecutable('pwsh');
  if (pwshPath) {
    let newchild = spawn('pwsh.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `
  Import-Module PSAppDeployToolkit -Force;
  Show-ADTHelpConsole
  `
    ], {

    });

    newchild.stdout.on('data', (data) => {
      console.log(`${data}`);
    });

    newchild.stderr.on('data', (data) => {
      console.log(`${data}`);
    });

    newchild.on('close', (code) => {
      console.log(code);
    });
  }

};

const listPsadtCmdlets = async () => {
  let prom = await new Promise((resolve, reject) => {
    const pwshPath = checkExecutable('powershell');
    if (pwshPath) {
      let newchild = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `
  Import-Module PSAppDeployToolkit -Force | Out-Null;
  Get-ADTCommandTable | Foreach-Object { $_.Keys } | ConvertTo-Json
  `
      ], {
        env: {}
      });

      let alldata = [];
      newchild.stdout.on('data', (data) => {
        console.log(`${data}`);
        alldata.push(data);
      });

      newchild.stderr.on('data', (data) => {
        console.log(`${data}`);
      });

      newchild.on('close', (code) => {
        console.log(code);
        let output = alldata.join();
        let jsonoutput = {};
        try{
          jsonoutput = JSON.parse(output);
        } catch (err) {}

        resolve(jsonoutput);
      });
    }
    else {
      reject();
    }
  });
  return prom;
};

const getpsadtcmdletexample = async (arg) => {
  let prom = await new Promise((resolve, reject) => {
    const pwshPath = checkExecutable('powershell');
    if (pwshPath) {
      let newchild = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `
  Import-Module PSAppDeployToolkit -Force | Out-Null;
  Get-Help ${arg} -Full
  `
      ], {
        env: {}
      });

      let alldata = '';

      newchild.stdout.on('data', (data) => {
        console.log(`${data}`);
        alldata += `${data}`;
      });

      newchild.stderr.on('data', (data) => {
        console.log(`${data}`);
      });

      newchild.on('close', (code) => {
        console.log(code);

        let output = alldata
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

        console.log(output);
        output = output.replace(/```(\w+)([\s\S]*?)```/g, (match, language, code) => {
          return `<div style="color: #f1f14d">\`\`\`${language}${code}\`\`\`</div>`;
        });
        resolve({ data: output });
      });
    }
    else {
      reject();
    }
  });
  return prom;
};

app.commandLine.appendSwitch('remote-debugging-port', '9222');

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
    },
  });

  const appVersion = app.getVersion();

  // Set the title once the content is loaded to avoid it being overwritten
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault(); // Prevents the title in index.html from changing the window title
  });

  mainWindow.setTitle(`Deployment Manager - v${appVersion}`);

  ipcMain.on('iframe-message', (event, data) => {
    if (!data) return;
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

  // Allows triggering fullscreen from embedded reactjs client
  //
  // use the following from react client
  //   // go fullscreen
  // window.electronAPI.setFullscreen(true);
  //
  // // exit fullscreen
  // window.electronAPI.setFullscreen(false);
  //
  // // toggle
  // window.electronAPI.toggleFullscreen();
  //
  ipcMain.on('set-fullscreen', (event, flag) => {
    //const win = BrowserWindow.fromWebContents(event.sender);
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(flag);
  });

  ipcMain.on('toggle-fullscreen', (event) => {
    //const win = BrowserWindow.fromWebContents(event.sender);
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  ipcMain.on('open-psadtref', () => {
    openPsadtReference();
  });

  ipcMain.handle('list-psadtcmdlets', async () => {
    return await listPsadtCmdlets();
  });

  ipcMain.handle('get-psadtcmdletexample', async (event, args) => {
    return await getpsadtcmdletexample(args);
  });

  mainWindow.removeMenu();

  // Open external links in the system default browser instead of a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Right-click context menu
  mainWindow.webContents.on('context-menu', (event, params) => {
    const template = [];

    if (params.selectionText) {
      template.push({ label: 'Copy', click: () => mainWindow.webContents.copy() });
    }

    if (params.isEditable) {
      template.push({ label: 'Paste', click: () => mainWindow.webContents.paste() });
    }

    if (template.length > 0) template.push({ type: 'separator' });

    template.push({
      label: 'Find on Page',
      click: () => mainWindow.webContents.send('show-find-bar'),
    });

    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });

  // Relay find-in-page results back to renderer
  mainWindow.webContents.on('found-in-page', (event, result) => {
    mainWindow.webContents.send('found-in-page', result);
  });

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

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('fullscreen-changed', true);
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('fullscreen-changed', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const serverPath = path.join(__dirname, '../server/index.js');
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: String(SERVER_PORT),
        NODE_ENV: 'production',
        ELECTRON_USER_DATA: app.getPath('userData'),
        ELECTRON_IS_PACKAGED: '1',
      },
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

ipcMain.on('find-in-page', (event, text) => {
  if (text) mainWindow?.webContents.findInPage(text);
  else mainWindow?.webContents.stopFindInPage('clearSelection');
});

ipcMain.on('stop-find', () => {
  mainWindow?.webContents.stopFindInPage('clearSelection');
});

ipcMain.handle('pick-file', async (_event, options = {}) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: options.filters || [],
  });
  return result.canceled ? null : result.filePaths[0];
});

app.whenReady().then(() => {

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

  // Fullscreen support
  globalShortcut.register('F11', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
  });

  globalShortcut.register('F5', () => {
    BrowserWindow.getFocusedWindow()?.reload();
  });

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
