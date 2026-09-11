const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  onCursor: (cb) => ipcRenderer.on('pet:cursor', (_e, d) => cb(d)),
  onGeometry: (cb) => ipcRenderer.on('pet:geometry', (_e, d) => cb(d)),
  onCommand: (cb) => ipcRenderer.on('pet:command', (_e, d) => cb(d)),
  setHitbox: (box) => ipcRenderer.send('pet:hitbox', box),
  setHeld: (v) => ipcRenderer.send('pet:held', v),
  say: (trigger, ctx) => ipcRenderer.invoke('pet:say', { trigger, ctx })
});
