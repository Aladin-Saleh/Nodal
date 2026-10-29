import path from 'node:path';
import { app, BrowserWindow } from 'electron';

/** Chemin de l'index.html du renderer une fois buildé. */
export function getRendererIndexPath(): string {
  return path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  );
}

export function createMainWindow(): BrowserWindow {
  const isDev = !app.isPackaged;
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Nodal',
    show: false,
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: isDev,
    },
  });

  window.once('ready-to-show', () => window.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(getRendererIndexPath());
  }

  // DevTools en développement, sauf pendant les tests de bout en bout.
  if (isDev && !process.env.NODAL_E2E_USER_DATA) {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}
