const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trackerDesktop', Object.freeze({
  minimize: () => ipcRenderer.invoke('tracker:minimize'),
  setPinned: value => ipcRenderer.invoke('tracker:pin', value),
  openDashboard: () => ipcRenderer.invoke('tracker:dashboard'),
}));
