import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  session,
  shell,
} from 'electron';
import started from 'electron-squirrel-startup';
import { IPC_EVENTS, type AppInfo } from '../shared/ipc-contract';
import { NODE_LINK_SCHEME } from '../shared/node-links';
import {
  stepZoom,
  type AppPreferences,
  type PreferencesUpdate,
} from '../shared/preferences';
import { buildAppMenu } from './app-menu';
import { createAppUrlMatcher } from './app-url';
import { CaptureController } from './capture/capture-controller';
import { QuickCaptureService } from './capture/quick-capture-service';
import { getSqliteVersion } from './database/connection';
import { createFileDialogs } from './file-dialogs';
import { routeSenderByChannel } from './ipc/handler';
import {
  assistantConfigFiles,
  claudeCodeProjects,
  updateAssistantConfigs,
  workspaceCodeRoots,
} from './mcp-config-update';
import { installMcpServer, MCP_SERVER_FILE_NAME } from './mcp-server-install';
import { installNode } from './node-install';
import { nodeLinkInArgs, resolveNodeLink } from './node-link-handler';
import { refreshSkills } from './skill-install';
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
import { loadNodePty, TerminalService } from './terminal/terminal-service';

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

// Désinstallation : les liens nodal:// ne doivent plus viser Nodal.
if (process.argv.includes('--squirrel-uninstall')) {
  app.removeAsDefaultProtocolClient(NODE_LINK_SCHEME);
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

  // Installé : serveur MCP recopié vers un chemin stable à chaque démarrage
  // (voir mcp-server-install.ts). En développement : bundle de Vite.
  const bundledMcpServer = path.join(
    process.resourcesPath,
    MCP_SERVER_FILE_NAME,
  );
  const mcpServerPath = app.isPackaged
    ? installMcpServer(
        bundledMcpServer,
        path.join(app.getPath('userData'), 'mcp'),
      )
    : path.join(app.getAppPath(), '.vite', 'build', MCP_SERVER_FILE_NAME);
  // Node livré avec l'application : rien à installer pour les assistants.
  const nodePath = app.isPackaged
    ? installNode(
        path.join(process.resourcesPath, 'node'),
        path.join(app.getPath('userData'), 'mcp'),
      )
    : 'node';

  // Assistants configurés avec le chemin d'une version installée (Nodal
  // 1.4.0 et avant) : basculés sur le chemin stable, sans action de
  // l'utilisateur (voir mcp-config-update.ts).
  const updateAssistants = () => {
    if (!app.isPackaged || mcpServerPath === bundledMcpServer) return;
    const home = app.getPath('home');
    const projectDirs = [
      ...claudeCodeProjects(home),
      ...workspaceCodeRoots(recent.list().map((entry) => entry.filePath)),
    ];
    const files = assistantConfigFiles({
      home,
      appData: app.getPath('appData'),
      projectDirs,
    });
    const changed = updateAssistantConfigs(
      files,
      // <racine>/app-X.Y.Z/resources → <racine>
      path.dirname(path.dirname(process.resourcesPath)),
      mcpServerPath,
    );
    if (changed.length > 0) {
      console.info('[mcp] configuration des assistants mise à jour', changed);
    }
    const skills = refreshSkills(projectDirs);
    if (skills.length > 0) console.info('[mcp] skills mis à jour', skills);
  };

  // Terminal intégré : shell dans le premier dossier de code de l'espace,
  // sinon dans le dossier de son fichier.
  const terminals = new TerminalService({
    pty: () => loadNodePty(app.isPackaged ? process.resourcesPath : null),
    emit: (event) => mainWindow?.webContents.send(IPC_EVENTS.terminal, event),
    cwd: () => {
      const file = workspaces.getCurrent()?.filePath;
      if (!file) return app.getPath('home');
      const [root] = workspaceCodeRoots([file]).filter((dir) =>
        fs.existsSync(dir),
      );
      return root ?? path.dirname(file);
    },
    folders: () => {
      const file = workspaces.getCurrent()?.filePath;
      return file ? workspaceCodeRoots([file]) : [];
    },
    workspaceFile: () => workspaces.getCurrent()?.filePath ?? null,
  });

  let appInfo: AppInfo | null = null;
  const getAppInfo = (): AppInfo =>
    (appInfo ??= {
      appName: app.getName(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      sqliteVersion: getSqliteVersion(),
      mcpServerPath,
      nodePath,
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

  // Liens nodal://node/… reçus au lancement, par une seconde instance ou
  // depuis un document : gardés jusqu'à ce que le renderer les demande
  // (link:takePending), puis résolus avec l'espace ouvert à ce moment-là.
  let pendingLink = nodeLinkInArgs(process.argv);
  const receiveNodeLink = (raw: string) => {
    pendingLink = raw;
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send(IPC_EVENTS.nodeLink);
  };
  const takeNodeLink = () => {
    const raw = pendingLink;
    pendingLink = null;
    if (raw === null) return null;
    return resolveNodeLink(raw, {
      current: () => {
        const info = workspaces.getCurrent();
        return info ? { id: info.id, db: workspaces.getDatabase() } : null;
      },
      recent: () => recent.list(),
    });
  };

  app.on('web-contents-created', (_event, contents) =>
    hardenWebContents(contents, isAppUrl, receiveNodeLink),
  );

  app.on('second-instance', (_event, argv) => {
    const link = nodeLinkInArgs(argv);
    if (link) {
      receiveNodeLink(link);
      return;
    }
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
  const recent = new RecentWorkspacesStore(
    path.join(userData, 'recent-workspaces.json'),
  );
  const capture = new CaptureController({
    service: new QuickCaptureService({ workspaces, recent }),
    onCapturedInOpenWorkspace: () =>
      mainWindow?.webContents.send(IPC_EVENTS.externalChange),
    zoomFactor: () => preferences.get().zoom / 100,
  });
  const updatePreferences = (changes: PreferencesUpdate): AppPreferences => {
    const next = preferences.update(changes);
    nativeTheme.themeSource = next.theme;
    applyZoom(next);
    capture.applyPreferences(next);
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
    // Version installée seulement : en développement, l'enregistrement
    // remplacerait celui de la Nodal installée.
    if (app.isPackaged) app.setAsDefaultProtocolClient(NODE_LINK_SCHEME);
    applySessionSecurity(session.defaultSession);
    Menu.setApplicationMenu(buildAppMenu(getMainWindow));
    registerIpcHandlers(ipcMain, {
      workspaces,
      recent,
      dialogs,
      trash: (filePath) => shell.trashItem(filePath),
      getAppInfo,
      userFolders: {
        home: app.getPath('home'),
        appData: app.getPath('appData'),
      },
      setUnsavedChanges,
      getPreferences: () => preferences.get(),
      updatePreferences,
      isTrustedSender: routeSenderByChannel(
        createSenderValidator(getMainWindow, isAppUrl),
        createSenderValidator(capture.getWindow, isAppUrl),
      ),
      quickCapture: capture,
      terminals,
      takeNodeLink,
      receiveNodeLink,
    });
    openWindow();
    capture.applyPreferences(preferences.get());
    setInterval(pollExternalChanges, EXTERNAL_CHANGE_POLL_MS);
    setTimeout(updateAssistants, 0);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
    });
  });

  app.on('window-all-closed', () => {
    closeWorkspace();
    if (process.platform !== 'darwin') app.quit();
  });

  // Checkpoint WAL + fermeture : il ne doit rester qu'un seul fichier .nodal.
  app.on('will-quit', () => {
    terminals.closeAll();
    capture.release();
    closeWorkspace();
  });
}
