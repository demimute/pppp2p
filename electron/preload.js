const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Folder selection
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  // Backend process management
  startBackend: () => ipcRenderer.invoke('start-backend'),
  killBackend: () => ipcRenderer.invoke('kill-backend'),
  getPythonStatus: () => ipcRenderer.invoke('python-status'),
  
  // Python ready event
  onPythonReady: (callback) => {
    ipcRenderer.on('python-ready', (_event, payload) => callback(payload));
  },
  
  // Menu events
  onMenuSelectFolder: (callback) => {
    ipcRenderer.on('menu-select-folder', () => callback());
  },
  
  // Generic IPC invoke
  invoke: (channel, data) => {
    const validChannels = ['select-folder', 'api-call', 'start-backend', 'kill-backend', 'python-status'];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
    throw new Error(`Invalid channel: ${channel}`);
  },
  
  // API call proxy
  apiCall: (method, endpoint, body) => ipcRenderer.invoke('api-call', { method, endpoint, body }),
});
