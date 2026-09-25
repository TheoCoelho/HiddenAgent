const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveText: (text) => ipcRenderer.send('notes:save', text),
  setOpacity: (value) => ipcRenderer.send('window:opacity', value),
  toggleProtection: () => ipcRenderer.invoke('protection:toggle'),
  minimize: () => ipcRenderer.send('window:minimize'),
  quit: () => ipcRenderer.send('window:quit'),

  // Assistente
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  setProvider: (provider) => ipcRenderer.invoke('ai:set-provider', provider),
  setModel: (provider, model) => ipcRenderer.invoke('ai:set-model', provider, model),
  setKey: (provider, key) => ipcRenderer.invoke('ai:set-key', provider, key),
  clearKey: (provider) => ipcRenderer.invoke('ai:clear-key', provider),
  ask: (payload) => ipcRenderer.send('ai:ask', payload),
  abort: () => ipcRenderer.send('ai:abort'),
  onAi: ({ chunk, done, error }) => {
    ipcRenderer.on('ai:chunk', (_e, text) => chunk(text));
    ipcRenderer.on('ai:done', (_e, info) => done(info));
    ipcRenderer.on('ai:error', (_e, message) => error(message));
  },
});
