import { app, BrowserWindow, ipcMain, session } from 'electron';
import started from 'electron-squirrel-startup';
import type { AppInfo } from '../shared/ipc-contract';
import { createAppUrlMatcher } from './app-url';
import { getSqliteVersion } from './database/connection';
import { registerIpcHandlers } from './ipc/register';
import {
  applySessionSecurity,
  createSenderValidator,
  hardenWebContents,
} from './security';
import { createMainWindow, getRendererIndexPath } from './window';
import { createWorkspaceDialogs } from './workspace/workspace-dialogs';
import { WorkspaceService } from './workspace/workspace-service';

// Installation / désinstallation Squirrel : créer les raccourcis puis quitter.
if (started) {
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  // Une seule instance : évite deux processus écrivant dans le même .nodal.
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  let mainWindow: BrowserWindow | null = null;
  const getMainWindow = () => mainWindow;

  const isAppUrl = createAppUrlMatcher({
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    rendererIndexPath: getRendererIndexPath(),
  });
  const workspaces = new WorkspaceService();

  let appInfo: AppInfo | null = null;
  const getAppInfo = (): AppInfo =>
    (appInfo ??= {
      appName: app.getName(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      sqliteVersion: getSqliteVersion(),
    });

  const closeWorkspace = () => {
    try {
      workspaces.close();
    } catch (error) {
      console.error('[app] échec de fermeture de l’espace', error);
    }
  };

  app.on('web-contents-created', (_event, contents) =>
    hardenWebContents(contents, isAppUrl),
  );

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  const openWindow = () => {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  };

  void app.whenReady().then(() => {
    applySessionSecurity(session.defaultSession);
    registerIpcHandlers(ipcMain, {
      workspaces,
      dialogs: createWorkspaceDialogs(getMainWindow),
      getAppInfo,
      isTrustedSender: createSenderValidator(getMainWindow, isAppUrl),
    });
    openWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
    });
  });

  app.on('window-all-closed', () => {
    closeWorkspace();
    if (process.platform !== 'darwin') app.quit();
  });

  // Checkpoint WAL + fermeture : il ne doit rester qu'un seul fichier .nodal.
  app.on('will-quit', closeWorkspace);
}
