const { contextBridge, ipcRenderer } = require('electron');
const { clipboard } = require('electron');


// contextBridge.exposeInMainWorld('electronAPI', {
//   sendToMain: (data) => ipcRenderer.send('iframe-message', data)
// });

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  sendToMain: (data) => ipcRenderer.send('iframe-message', data)
});

ipcRenderer.on('clipboard-updated', (event, text) => {
  //alert(`Clipboard updated with: ${text}`);
});