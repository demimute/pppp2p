const { app, BrowserWindow, ipcMain, dialog, Menu, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess = null;
let backendManaged = false;
const BACKEND_PORT = 18765;
const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

async function loadRenderer(window) {
  const devServerReady = isDev && await isPortOpen(5173);

  if (devServerReady) {
    await window.loadURL('http://127.0.0.1:5173');
    return;
  }

  const distEntry = path.join(__dirname, '../dist/index.html');
  if (fs.existsSync(distEntry)) {
    await window.loadFile(distEntry);
    return;
  }

  throw new Error(`Renderer entry not found: ${distEntry}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    backgroundColor: '#f9fafb',
    titleBarStyle: 'defaultInset',
  });

  const menuTemplate = [
    {
      label: '文件',
      submenu: [
        {
          label: '选择文件夹',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu-select-folder'),
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  loadRenderer(mainWindow).catch((error) => {
    console.error('[Renderer load error]:', error);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const onFail = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', onFail);
    socket.once('timeout', onFail);
    socket.connect(port, '127.0.0.1');
  });
}

async function startPythonBackend() {
  if (pythonProcess || backendManaged) return;

  const existing = await isPortOpen(BACKEND_PORT);
  if (existing) {
    backendManaged = false;
    if (mainWindow) {
      mainWindow.webContents.send('python-ready');
    }
    return;
  }

  const pythonScript = path.join(__dirname, '../backend/app.py');
  pythonProcess = spawn('python3.11', [pythonScript], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, DEDUP_BACKEND_PORT: String(BACKEND_PORT) },
  });
  backendManaged = true;

  pythonProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    console.log('[Python stdout]:', msg);
    if (mainWindow && msg.includes('Running on')) {
      mainWindow.webContents.send('python-ready');
    }
  });

  pythonProcess.stderr.on('data', async (data) => {
    const message = data.toString();
    console.error('[Python stderr]:', message);

    if (message.includes('Address already in use')) {
      const existingBackend = await isPortOpen(BACKEND_PORT);
      if (existingBackend && mainWindow) {
        mainWindow.webContents.send('python-ready');
      }
    }
  });

  pythonProcess.on('error', (err) => {
    console.error('[Python process error]:', err);
    pythonProcess = null;
    backendManaged = false;
  });

  pythonProcess.on('exit', (code) => {
    console.log(`[Python process exited with code ${code}]`);
    pythonProcess = null;
    backendManaged = false;
  });
}

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择照片文件夹',
  });

  if (result.canceled) {
    return { canceled: true, folder: null };
  }
  return { canceled: false, folder: result.filePaths[0] };
});

ipcMain.handle('start-backend', async () => {
  await startPythonBackend();
  return { started: true };
});

ipcMain.handle('kill-backend', async () => {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
    backendManaged = false;
  }
  return { killed: true };
});

ipcMain.handle('python-status', async () => {
  const externalBackend = await isPortOpen(BACKEND_PORT);
  return { running: pythonProcess !== null || externalBackend };
});

ipcMain.handle('api-call', async (_event, { method, endpoint, body }) => {
  const url = `http://127.0.0.1:${BACKEND_PORT}${endpoint}`;
  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return { success: response.ok, data, error: response.ok ? null : data.error };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.whenReady().then(async () => {
  protocol.registerFileProtocol('local-file', (request, callback) => {
    const url = request.url.replace('local-file://', '');
    callback({ path: decodeURIComponent(url) });
  });

  createWindow();
  await startPythonBackend();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
    backendManaged = false;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
    backendManaged = false;
  }
});
