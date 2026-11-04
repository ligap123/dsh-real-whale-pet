const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rippleBridge', {
  readAsset: relative => ipcRenderer.invoke('asset:read', relative),
  done: token => ipcRenderer.send('overlay:done', token),
  onPlay: callback => ipcRenderer.on('ripple:play', (_, payload) => callback(payload)),
  onClear: callback => ipcRenderer.on('ripple:clear', callback)
});
