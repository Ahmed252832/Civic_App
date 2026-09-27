const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('civic', {
  request: (method, payload) => ipcRenderer.invoke('civic:request', method, payload),
  onNotice: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('civic:notice', listener);
    return () => ipcRenderer.removeListener('civic:notice', listener);
  }
});
