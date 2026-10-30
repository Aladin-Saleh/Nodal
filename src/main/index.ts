import path from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  session,
  shell,
} from 'electron';
import started from 'electron-squirrel-startup';
import { IPC_EVENTS, type AppInfo } from '../shared/ipc-contract';
import {
  stepZoom,
  type AppPreferences,
  type PreferencesUpdate,
} from '../shared/preferences';
import { createAppUrlMatcher } from './app-url';
import { getSqliteVersion } from './database/connection';
import { createFileDialogs } from './file-dialogs';
import { registerIpcHandlers } from './ipc/register';
import { PreferencesStore, WindowStateStore } from './preferences-store';
import {
  applySessionSecurity,
  createSenderValidator,
  hardenWebContents,
} from './security';
import { createMainWindow, getRendererIndexPath } from './window';
import { RecentWorkspacesStore } from './workspace/recent-workspaces';
import { WorkspaceService } from './workspace/workspace-service';

/** Délai laissé au renderer pour enregistrer avant de demander confirmation. */
const FLUSH_TIMEOUT_MS = 3000;
/** Intervalle de détection des écritures externes (serveur MCP). */
const EXTERNAL_CHANGE_POLL_MS = 1000;

// Tests de bout en bout (version non packagée uniquement) : profil isolé,
// pour ne toucher ni aux espaces récents ni au verrou de l'utilisateur.
const e2eUserData = process.env.NODAL_E2E_USER_DATA;
if (!app.isPackaged && e2eUserData) {
  app.setPath('userData', e2eUserData);
}

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
  const dialogs = createFileDialogs(getMainWindow);

  let appInfo: AppInfo | null = null;
  const getAppInfo = (): AppInfo =>
    (appInfo ??= {
      appName: app.getName(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      sqliteVersion: getSqliteVersion(),
      mcpServerPath: app.isPackaged
        ? path.join(process.resourcesPath, 'nodal-mcp.cjs')
        : path.join(app.getAppPath(), '.vite', 'build', 'nodal-mcp.cjs'),
    });

  const closeWorkspace = () => {
    try {
      workspaces.close();
    } catch (error) {
      console.error('[app] échec de fermeture de l’espace', error);
    }
  };

  // Fermeture avec des modifications en attente (§6.1) : on demande au
  // renderer d'enregistrer, puis on ferme ; sinon on demande confirmation.
  let unsavedChanges = false;
  let closeRequested = false;
  let forceClose = false;

  const setUnsavedChanges = (unsaved: boolean) => {
    unsavedChanges = unsaved;
    if (!unsaved && closeRequested && mainWindow) {
      closeRequested = false;
      forceClose = true;
      mainWindow.close();
    }
  };

  const handleClose = (event: Electron.Event) => {
    if (forceClose || !unsavedChanges || !mainWindow) return;
    event.preventDefault();
    if (closeRequested) return;
    closeRequested = true;
    mainWindow.webContents.send(IPC_EVENTS.flushRequest);
    setTimeout(() => {
      if (!closeRequested || !mainWindow) return;
      void dialogs
        .confirm({
          message: 'Des modifications n’ont pas pu être enregistrées.',
          detail:
            'Fermer quand même ? Les dernières modifications seront perdues.',
          confirmLabel: 'Fermer sans enregistrer',
        })
        .then((confirmed) => {
          closeRequested = false;
          if (confirmed && mainWindow) {
            forceClose = true;
            mainWindow.close();
          }
        });
    }, FLUSH_TIMEOUT_MS);
  };

  // Écritures d'un autre processus (assistant IA via MCP) : le renderer
  // recharge ce qu'il affiche.
  const pollExternalChanges = () => {
    try {
      if (workspaces.takeExternalChange()) {
        mainWindow?.webContents.send(IPC_EVENTS.externalChange);
      }
    } catch (error) {
      console.error('[app] lecture de data_version impossible', error);
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

  // Préférences de l'application : le thème est appliqué avant la création
  // de la fenêtre (pas de flash de couleur), le zoom à chaque chargement.
  const userData = app.getPath('userData');
  const preferences = new PreferencesStore(
    path.join(userData, 'preferences.json'),
  );
  const windowState = new WindowStateStore(
    path.join(userData, 'window-state.json'),
  );
  const applyZoom = (current: AppPreferences) =>
    mainWindow?.webContents.setZoomFactor(current.zoom / 100);
  const updatePreferences = (changes: PreferencesUpdate): AppPreferences => {
    const next = preferences.update(changes);
    nativeTheme.themeSource = next.theme;
    applyZoom(next);
    return next;
  };
  nativeTheme.themeSource = preferences.get().theme;

  /** Ctrl+= / Ctrl+- / Ctrl+0 : taille du texte, mémorisée dans les préférences. */
  const handleZoomShortcut = (event: Electron.Event, input: Electron.Input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const current = preferences.get().zoom;
    const zoom =
      input.key === '+' || input.key === '='
        ? stepZoom(current, 1)
        : input.key === '-'
          ? stepZoom(current, -1)
          : input.key === '0'
            ? 100
            : null;
    if (zoom === null) return;
    // Empêche aussi le zoom du menu par défaut, non mémorisé.
    event.preventDefault();
    if (zoom === current) return;
    const next = updatePreferences({ zoom });
    mainWindow?.webContents.send(IPC_EVENTS.preferencesChanged, next);
  };

  const openWindow = () => {
    forceClose = false;
    unsavedChanges = false;
    mainWindow = createMainWindow({
      state: windowState.get(),
      onStateChange: (state) => windowState.save(state),
    });
    mainWindow.webContents.on('did-finish-load', () =>
      applyZoom(preferences.get()),
    );
    mainWindow.webContents.on('before-input-event', handleZoomShortcut);
    mainWindow.on('close', handleClose);
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  };

  void app.whenReady().then(() => {
    applySessionSecurity(session.defaultSession);
    registerIpcHandlers(ipcMain, {
      workspaces,
      recent: new RecentWorkspacesStore(
        path.join(app.getPath('userData'), 'recent-workspaces.json'),
      ),
      dialogs,
      trash: (filePath) => shell.trashItem(filePath),
      getAppInfo,
      setUnsavedChanges,
      getPreferences: () => preferences.get(),
      updatePreferences,
      isTrustedSender: createSenderValidator(getMainWindow, isAppUrl),
    });
    openWindow();
    setInterval(pollExternalChanges, EXTERNAL_CHANGE_POLL_MS);

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
