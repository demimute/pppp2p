const { app, BrowserWindow, ipcMain, dialog, Menu, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess = null;
let backendManaged = false;
let isQuitting = false;
let backendStatus = {
  running: false,
  source: 'unknown',
  message: '后端状态未知',
};
const BACKEND_PORT = 18765;
const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
const useViteDevServer = process.env.DEDUP_USE_VITE_DEV_SERVER === '1';
const RUNTIME_LOG = path.join(os.tmpdir(), 'dedupstudio-electron.log');
const BACKEND_WARNING_PATTERNS = [
  'UserWarning:',
  'QuickGELU mismatch',
  'warnings.warn(',
  'Warning: You are sending unauthenticated requests to the HF Hub',
  'WARNING:huggingface_hub.utils._http:',
];
const RUNTIME_ICON = path.join(__dirname, '../resources/icon.png');

function appendRuntimeLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(RUNTIME_LOG, line);
  } catch (error) {
    console.error('[Runtime log write failed]:', error);
  }
}

function trace(message, payload) {
  const suffix = payload === undefined ? '' : ` ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`;
  const finalMessage = `${message}${suffix}`;
  console.log(finalMessage);
  appendRuntimeLog(finalMessage);
}

function updateBackendStatus(patch = {}) {
  backendStatus = { ...backendStatus, ...patch };
  if (mainWindow) {
    mainWindow.webContents.send('python-ready', backendStatus);
  }
}

async function waitForPort(port, attempts = 20, delayMs = 500) {
  for (let i = 0; i < attempts; i += 1) {
    if ((await isPortOpen(port, '127.0.0.1')) || (await isPortOpen(port, '::1'))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function loadRenderer(window) {
  const devServerReady = isDev && useViteDevServer && await waitForPort(5173);

  if (devServerReady) {
    await window.loadURL('http://localhost:5173');
    return;
  }

  const distEntry = path.join(__dirname, '../dist/index.html');
  if (fs.existsSync(distEntry)) {
    await window.loadFile(distEntry);
    return;
  }

  throw new Error(`Renderer entry not found: ${distEntry}`);
}

function showFatalError(title, error) {
  const detail = String(error?.stack || error?.message || error || 'unknown error');
  console.error(`[${title}]`, detail);
  if (app.isReady()) {
    dialog.showErrorBox(title, detail);
  }
}

function createWindow() {
  if (process.platform === 'darwin' && app.dock && fs.existsSync(RUNTIME_ICON)) {
    app.dock.setIcon(RUNTIME_ICON);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'PPPP2P',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: isDev,
    backgroundColor: '#f9fafb',
    titleBarStyle: 'defaultInset',
    icon: fs.existsSync(RUNTIME_ICON) ? RUNTIME_ICON : undefined,
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

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    trace('[Renderer did-fail-load]:', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on('did-finish-load', () => {
    trace('[Renderer did-finish-load]:', mainWindow.webContents.getURL());
    if (!mainWindow?.isVisible()) {
      mainWindow.show();
    }
    // Keep DevTools available from the View menu, but do not auto-open in dev.
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    trace('[Renderer process gone]:', details);
    if (!isQuitting) {
      showFatalError('Renderer 进程异常退出', JSON.stringify(details, null, 2));
    }
  });

  mainWindow.on('unresponsive', () => {
    trace('[Main window unresponsive]');
  });

  mainWindow.on('close', () => {
    trace('[Main window close event]');
  });

  loadRenderer(mainWindow).catch((error) => {
    trace('[Renderer load error]:', String(error?.stack || error?.message || error));
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
      <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; background: #f8fafc; color: #111827;">
          <h2>Renderer load failed</h2>
          <pre style="white-space: pre-wrap; background: white; border: 1px solid #e5e7eb; padding: 12px; border-radius: 8px;">${String(error.stack || error.message || error)}</pre>
        </body>
      </html>
    `)}`);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    trace('[Main window closed event]');
    mainWindow = null;
  });
}

function isPortOpen(port, host = '127.0.0.1') {
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
    socket.connect(port, host);
  });
}

async function startPythonBackend() {
  if (pythonProcess || backendManaged) return;

  const existing = await isPortOpen(BACKEND_PORT);
  if (existing) {
    backendManaged = false;
    updateBackendStatus({
      running: true,
      source: 'external',
      message: '已接管现有后端服务',
    });
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
    trace('[Python stdout]:', msg);
    if (mainWindow && msg.includes('Running on')) {
      updateBackendStatus({
        running: true,
        source: 'managed',
        message: '内置后端已启动',
      });
    }
  });

  pythonProcess.stderr.on('data', async (data) => {
    const message = data.toString();
    const normalizedMessage = message.trim();
    trace('[Python stderr]:', normalizedMessage);

    if (BACKEND_WARNING_PATTERNS.some((pattern) => normalizedMessage.includes(pattern))) {
      const backendReady = await isPortOpen(BACKEND_PORT);
      if (backendReady) {
        updateBackendStatus({
          running: true,
          source: backendManaged ? 'managed' : 'external',
          message: backendManaged ? '内置后端已启动' : '已接管现有后端服务',
        });
      }
      return;
    }

    if (message.includes('Address already in use')) {
      const existingBackend = await isPortOpen(BACKEND_PORT);
      if (existingBackend) {
        updateBackendStatus({
          running: true,
          source: 'external',
          message: '检测到现有后端，已直接复用',
        });
        return;
      }
    }

    // Flask dev server emits startup warnings to stderr even when backend is healthy.
    if (
      message.includes('WARNING: This is a development server') ||
      message.includes('Press CTRL+C to quit') ||
      message.includes('127.0.0.1 - - [') ||
      message.includes('INFO:werkzeug:127.0.0.1 - - [')
    ) {
      const backendReady = await isPortOpen(BACKEND_PORT);
      if (backendReady) {
        updateBackendStatus({
          running: true,
          source: 'managed',
          message: '内置后端已启动',
        });
        return;
      }
    }

    updateBackendStatus({
      running: false,
      source: 'error',
      message: normalizedMessage || '后端启动失败',
    });
  });

  pythonProcess.on('error', (err) => {
    trace('[Python process error]:', String(err?.stack || err?.message || err));
    pythonProcess = null;
    backendManaged = false;
    updateBackendStatus({
      running: false,
      source: 'error',
      message: err.message || '后端进程启动失败',
    });
  });

  pythonProcess.on('exit', (code) => {
    trace('[Python process exited]:', { code });
    pythonProcess = null;
    backendManaged = false;
    updateBackendStatus({
      running: false,
      source: code === 0 ? 'stopped' : 'error',
      message: code === 0 ? '内置后端已停止' : `后端进程已退出（code ${code}）`,
    });
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
  if (pythonProcess !== null) {
    return { running: true, source: 'managed', message: '内置后端运行中' };
  }
  if (externalBackend) {
    return { running: true, source: 'external', message: '现有后端服务可用' };
  }
  return backendStatus;
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

app.on('child-process-gone', (_event, details) => {
  trace('[Child process gone]:', details);
});

process.on('uncaughtException', (error) => {
  showFatalError('主进程未捕获异常', error);
});

process.on('unhandledRejection', (reason) => {
  showFatalError('主进程未处理 Promise 异常', reason);
});

app.on('browser-window-created', () => {
  trace('[Browser window created]');
});

app.on('before-quit', () => {
  trace('[App before-quit]');
  isQuitting = true;
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
    backendManaged = false;
  }
});

app.on('will-quit', () => {
  trace('[App will-quit]');
});

app.on('quit', (_event, exitCode) => {
  trace('[App quit]:', { exitCode });
});

app.whenReady().then(async () => {
  trace('[App ready]');
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
  trace('[App window-all-closed]', { isDev, isQuitting, platform: process.platform });
  if (isDev && !isQuitting) {
    return;
  }
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM');
    pythonProcess = null;
    backendManaged = false;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
