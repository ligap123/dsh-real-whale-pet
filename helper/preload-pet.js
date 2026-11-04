const { contextBridge, ipcRenderer } = require('electron');
const events = ['pet:init', 'pet:config', 'pet:reload', 'pet:sfx', 'pet:speech', 'pet:speech-close', 'pet:reaction', 'pet:balance'];
contextBridge.exposeInMainWorld('whaleBridge', {
  readAsset: relative => ipcRenderer.invoke('asset:read', relative),
  send: (channel, value) => { if (['pet:regions', 'pet:context-menu', 'pet:open-panel', 'pet:speech-close', 'pet:drag-start', 'pet:drag-move', 'pet:drag-end', 'pet:drag-cancel'].includes(channel)) ipcRenderer.send(channel, value); },
  on: (channel, callback) => { if (events.includes(channel)) ipcRenderer.on(channel, (_, value) => callback(value)); }
});
