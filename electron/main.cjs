const { app, BrowserWindow, screen, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

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
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('enable-features', 'MediaStreamTrack');

let consoleWindow = null;
let projectorWindow = null;
let localServer = null;
let localServerUrl = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function getDistDir() {
  const candidates = [
    path.join(__dirname, '../dist'),
    path.join(__dirname, 'dist'),
    path.join(process.resourcesPath || '', 'app.asar/dist'),
    path.join(process.resourcesPath || '', 'app/dist'),
    __dirname
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) {
      return c;
    }
  }
  return path.join(__dirname, '../dist');
}

/**
 * Starts a local loopback HTTP server on 127.0.0.1 with an ephemeral port.
 * Serving over http://127.0.0.1 guarantees a Secure Context for getUserMedia(),
 * WebAssembly streaming (MediaPipe WASM), BroadcastChannel sync, and localStorage.
 */
function startLocalServer(distDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const cleanUrl = (req.url || '/').split('?')[0];
        let relPath = cleanUrl === '/' ? 'index.html' : decodeURIComponent(cleanUrl).replace(/^\/+/, '');
        const resolvedPath = path.resolve(distDir, relPath);

        // Prevent directory traversal outside distDir
        if (!resolvedPath.startsWith(path.resolve(distDir))) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const ext = path.extname(resolvedPath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*'
        });
        fs.createReadStream(resolvedPath).pipe(res);
      } catch (err) {
        res.writeHead(500);
        res.end('Internal server error');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}/index.html` });
    });
  });
}

function getBaseAppUrl() {
  return process.env.VITE_DEV_SERVER_URL || localServerUrl;
}

function createConsoleWindow() {
  consoleWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'ProjectionFX - Stage Operator Console',
    backgroundColor: '#090b10',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  const targetUrl = getBaseAppUrl();
  consoleWindow.loadURL(targetUrl).catch((err) => {
    dialog.showErrorBox('Failed to Load UI', `Could not load ProjectionFX at ${targetUrl}:\n${err.message}`);
  });

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
  const primaryDisplay = screen.getPrimaryDisplay();
  const externalDisplay = displays.find(d => d.id !== primaryDisplay.id);
  const targetDisplay = externalDisplay || primaryDisplay;

  projectorWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y,
    width: targetDisplay.bounds.width,
    height: targetDisplay.bounds.height,
    fullscreen: !!externalDisplay,
    frame: false,
    backgroundColor: '#000000',
    title: 'ProjectionFX - Stage Projector Output',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  const baseUrl = getBaseAppUrl();
  const sep = baseUrl.includes('?') ? '&' : '?';
  projectorWindow.loadURL(`${baseUrl}${sep}mode=projector`);

  projectorWindow.on('closed', () => {
    projectorWindow = null;
    if (consoleWindow && !consoleWindow.isDestroyed()) {
      consoleWindow.webContents.send('projector-window-state', false);
    }
  });

  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.webContents.send('projector-window-state', true);
  }
}

ipcMain.on('open-projector', () => {
  createProjectorWindow();
});

ipcMain.on('close-projector', () => {
  if (projectorWindow) {
    projectorWindow.close();
  }
});

ipcMain.on('toggle-fullscreen-console', () => {
  if (consoleWindow) {
    consoleWindow.setFullScreen(!consoleWindow.isFullScreen());
  }
});

ipcMain.on('set-fullscreen-console', (event, flag) => {
  if (consoleWindow) {
    consoleWindow.setFullScreen(!!flag);
  }
});

app.whenReady().then(async () => {
  if (session && session.defaultSession) {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(true);
    });
    session.defaultSession.setPermissionCheckHandler(() => true);
  }

  if (!process.env.VITE_DEV_SERVER_URL) {
    const distDir = getDistDir();
    try {
      const started = await startLocalServer(distDir);
      localServer = started.server;
      localServerUrl = started.url;
    } catch (err) {
      dialog.showErrorBox('Local Server Failed', `Failed to start internal asset server:\n${err.message}`);
    }
  }

  createConsoleWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createConsoleWindow();
  });
});

app.on('window-all-closed', () => {
  if (localServer) {
    try { localServer.close(); } catch (_) {}
  }
  if (process.platform !== 'darwin') app.quit();
});
