import path from 'node:path';
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import type { WindowState } from './preferences-store';

/** Fond de la fenêtre avant le premier rendu (évite un flash de couleur). */
const BACKGROUND = { light: '#f6f7f9', dark: '#18191c' } as const;

/** La position mémorisée est-elle encore sur un écran (écran débranché) ? */
function isVisible(state: WindowState): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const x = Math.max(state.x, workArea.x);
    const y = Math.max(state.y, workArea.y);
    const right = Math.min(state.x + state.width, workArea.x + workArea.width);
    const bottom = Math.min(
      state.y + state.height,
      workArea.y + workArea.height,
    );
    // Au moins 100 × 50 px visibles, dont la barre de titre.
    return right - x >= 100 && bottom - y >= 50;
  });
}

/** Chemin de l'index.html du renderer une fois buildé. */
export function getRendererIndexPath(): string {
  return path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  );
}

/** Réglages de sécurité communs à toutes les fenêtres (§4.2). */
function secureWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    devTools: !app.isPackaged,
  };
}

/** Charge le renderer ; `hash` choisit l'écran (`capture`). */
function loadRenderer(window: BrowserWindow, hash?: string): void {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(
      hash
        ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${hash}`
        : MAIN_WINDOW_VITE_DEV_SERVER_URL,
    );
  } else {
    void window.loadFile(getRendererIndexPath(), hash ? { hash } : undefined);
  }
}

const currentBackground = () =>
  nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light;

/**
 * Petite fenêtre de capture rapide : même renderer et même sécurité que la
 * fenêtre principale, sans menu, au premier plan.
 */
export function createCaptureWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 480,
    height: 360,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Capture rapide — Nodal',
    show: false,
    backgroundColor: currentBackground(),
    webPreferences: secureWebPreferences(),
  });
  window.setMenu(null);
  window.once('ready-to-show', () => {
    window.show();
    window.focus();
  });
  loadRenderer(window, 'capture');
  return window;
}

export interface MainWindowOptions {
  /** Taille et position mémorisées ; `null` : valeurs par défaut. */
  state: WindowState | null;
  /** Appelé à la fermeture avec l'état à mémoriser. */
  onStateChange(state: WindowState): void;
}

export function createMainWindow({
  state,
  onStateChange,
}: MainWindowOptions): BrowserWindow {
  const isDev = !app.isPackaged;
  const restored = state && isVisible(state) ? state : null;
  const window = new BrowserWindow({
    width: restored?.width ?? 1280,
    height: restored?.height ?? 800,
    ...(restored && { x: restored.x, y: restored.y }),
    minWidth: 800,
    minHeight: 500,
    title: 'Nodal',
    show: false,
    backgroundColor: currentBackground(),
    webPreferences: secureWebPreferences(),
  });

  window.once('ready-to-show', () => {
    if (restored?.maximized) window.maximize();
    window.show();
  });

  // Taille « normale » (hors agrandissement), pour la restaurer telle quelle.
  window.on('close', () => {
    const bounds = window.getNormalBounds();
    onStateChange({ ...bounds, maximized: window.isMaximized() });
  });

  // Le fond suit le thème (redimensionnement, rechargement).
  const syncBackground = () => {
    if (window.isDestroyed()) return;
    window.setBackgroundColor(currentBackground());
  };
  nativeTheme.on('updated', syncBackground);
  window.on('closed', () => nativeTheme.off('updated', syncBackground));

  loadRenderer(window);

  // DevTools en développement, sauf pendant les tests de bout en bout.
  if (isDev && !process.env.NODAL_E2E_USER_DATA) {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}
