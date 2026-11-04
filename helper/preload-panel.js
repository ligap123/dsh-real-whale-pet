const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('settingsBridge', {
  state: () => ipcRenderer.invoke('panel:state'), style: value => ipcRenderer.invoke('panel:style', value),
  audio: value => ipcRenderer.invoke('panel:audio', value),
  balance: key => ipcRenderer.invoke('panel:balance', key), forget: () => ipcRenderer.invoke('panel:forget')
});
