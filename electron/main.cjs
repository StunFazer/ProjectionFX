const { app, BrowserWindow, screen, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// Global Error Catchers to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('[ProjectionFX] Uncaught Exception:', err);
  try {
    dialog.showErrorBox('ProjectionFX Fatal Error', (err && err.stack) ? err.stack : String(err));
  } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  console.error('[ProjectionFX] Unhandled Rejection:', reason);
  try {
    dialog.showErrorBox('ProjectionFX Unhandled Rejection', String(reason));
  } catch (_) {}
});

// Hardware acceleration & GPU compatibility switches
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('disable-http-cache');

let consoleWindow = null;
let projectorWindow = null;

function getDistIndexPath() {
  // Check candidate locations for dist/index.html
  const candidates = [
    path.join(__dirname, '../dist/index.html'),
    path.join(__dirname, 'dist/index.html'),
    path.join(process.resourcesPath || '', 'app.asar/dist/index.html'),
    path.join(process.resourcesPath || '', 'app/dist/index.html'),
    path.join(__dirname, 'index.html')
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return path.join(__dirname, '../dist/index.html');
}

function createConsoleWindow() {
  consoleWindow = new BrowserWindow({
    width: 1400,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'ProjectionFX - Operator Console',
    backgroundColor: '#0c0e12',
    show: false, // Show once ready-to-show to prevent flash
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    consoleWindow.loadURL(devUrl).catch((err) => {
      dialog.showErrorBox('Connection Failed', `Could not connect to Vite dev server at ${devUrl}:\n${err.message}`);
    });
  } else {
    const indexPath = getDistIndexPath();
    consoleWindow.loadFile(indexPath).catch((err) => {
      dialog.showErrorBox('Failed to Load UI', `Could not load index.html from:\n${indexPath}\n\nError: ${err.message}`);
    });
  }

  consoleWindow.once('ready-to-show', () => {
    consoleWindow.show();
  });

  consoleWindow.webContents.on('render-process-gone', (event, details) => {
    dialog.showErrorBox('Renderer Process Gone', `Reason: ${details.reason} (exit code: ${details.exitCode})`);
  });

  consoleWindow.on('closed', () => {
    consoleWindow = null;
    if (projectorWindow) projectorWindow.close();
  });
}

function createProjectorWindow() {
  if (projectorWindow) {
    projectorWindow.focus();
    return;
  }

  const displays = screen.getAllDisplays();
  const targetDisplay = displays.length > 1 ? displays[1] : displays[0];

  projectorWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    fullscreen: displays.length > 1,
    frame: false,
    backgroundColor: '#000000',
    title: 'ProjectionFX - Projector View',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    projectorWindow.loadURL(`${devUrl}?mode=projector`);
  } else {
    projectorWindow.loadFile(getDistIndexPath(), { query: { mode: 'projector' } });
  }

  projectorWindow.on('closed', () => {
    projectorWindow = null;
  });
}

// IPC handler for opening projector window from renderer
ipcMain.on('open-projector', () => {
  createProjectorWindow();
});

app.whenReady().then(() => {
  createConsoleWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createConsoleWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
