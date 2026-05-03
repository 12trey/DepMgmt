const { contextBridge, ipcRenderer } = require('electron');
const { clipboard } = require('electron');

// Single-slot callbacks for find bar (only one FindBar instance ever exists)
let _showFindBarCb = null;
let _foundInPageCb = null;
let _fullscreenChangedCb = null;

ipcRenderer.on('show-find-bar', () => _showFindBarCb?.());
ipcRenderer.on('found-in-page', (_e, result) => _foundInPageCb?.(result));
ipcRenderer.on('fullscreen-changed', (_e, flag) => _fullscreenChangedCb?.(flag));

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickFile: (options) => ipcRenderer.invoke('pick-file', options),
  sendToMain: (data) => ipcRenderer.send('iframe-message', data),

  // Find on page
  onShowFindBar: (cb) => { _showFindBarCb = cb; },
  onFoundInPage: (cb) => { _foundInPageCb = cb; },
  findInPage: (text) => ipcRenderer.send('find-in-page', text),
  stopFind: () => ipcRenderer.send('stop-find'),

  // full screen support
  setFullscreen: (flag) => ipcRenderer.send('set-fullscreen', flag),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  onFullscreenChanged: (cb) => { _fullscreenChangedCb = cb; },
});

ipcRenderer.on('clipboard-updated', (event, text) => {
  //alert(`Clipboard updated with: ${text}`);
});