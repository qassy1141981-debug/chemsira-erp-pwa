const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("nativeSQLite", {
  request: (json) => ipcRenderer.sendSync("accounting:sqlite", json),
});
