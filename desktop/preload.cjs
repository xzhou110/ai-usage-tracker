const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trackerDesktop', Object.freeze({
  minimize: () => ipcRenderer.invoke('tracker:minimize'),
  setPinned: value => ipcRenderer.invoke('tracker:pin', value),
  getWindowState: () => ipcRenderer.invoke('tracker:window-state'),
  setRightEdge: value => ipcRenderer.invoke('tracker:right-edge', value),
  onWindowState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('tracker:window-state', listener);
    return () => ipcRenderer.removeListener('tracker:window-state', listener);
  },
  openDashboard: () => ipcRenderer.invoke('tracker:dashboard'),
}));
