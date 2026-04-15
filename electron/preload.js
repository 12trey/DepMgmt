const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
});
