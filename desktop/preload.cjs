const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trackerDesktop', Object.freeze({
  minimize: () => ipcRenderer.invoke('tracker:minimize'),
  getWindowState: () => ipcRenderer.invoke('tracker:window-state'),
  setAutoHide: value => ipcRenderer.invoke('tracker:auto-hide', value),
  setInteractionHold: value => ipcRenderer.invoke('tracker:interaction-hold', value),
  onWindowState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('tracker:window-state', listener);
    return () => ipcRenderer.removeListener('tracker:window-state', listener);
  },
  openDashboard: () => ipcRenderer.invoke('tracker:dashboard'),
}));
