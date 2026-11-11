const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let consoleWindow = null;
let projectorWindow = null;

function createConsoleWindow() {
  consoleWindow = new BrowserWindow({
    width: 1400,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'ProjectionFX - Operator Console',
    backgroundColor: '#0c0e12',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    consoleWindow.loadURL('http://localhost:3000');
  } else {
    consoleWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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
  // If secondary display exists, place projector there; otherwise open on primary
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
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    projectorWindow.loadURL('http://localhost:3000/?mode=projector');
  } else {
    projectorWindow.loadFile(path.join(__dirname, '../dist/index.html'), { query: { mode: 'projector' } });
  }

  projectorWindow.on('closed', () => {
    projectorWindow = null;
  });
}

app.whenReady().then(() => {
  createConsoleWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createConsoleWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
