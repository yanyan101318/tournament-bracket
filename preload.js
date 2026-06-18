const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  printEscPos: (bufferArray) => ipcRenderer.send('print-esc-pos', bufferArray)
});
