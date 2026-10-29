/**
 * Durcissement Electron (§4.2) : navigation, fenêtres, permissions et
 * contrôle de l'émetteur des messages IPC.
 */
import {
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from 'electron';
import { isExternalWebUrl, type AppUrlMatcher } from './app-url';

/** Refuse toute demande de permission (caméra, notifications, etc.). */
export function applySessionSecurity(session: Session): void {
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
}

/** À appeler pour chaque WebContents créé (événement `web-contents-created`). */
export function hardenWebContents(
  contents: WebContents,
  isAppUrl: AppUrlMatcher,
): void {
  // Aucune nouvelle fenêtre : les liens web s'ouvrent dans le navigateur.
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const blockForeignNavigation = (
    event: { preventDefault(): void },
    url: string,
  ) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
    }
  };
  contents.on('will-navigate', blockForeignNavigation);
  contents.on('will-frame-navigate', (event) =>
    blockForeignNavigation(event, event.url),
  );
  contents.on('will-redirect', blockForeignNavigation);

  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/**
 * Un message IPC n'est accepté que s'il provient du cadre principal de la
 * fenêtre de l'application, chargé depuis l'URL de l'application.
 */
export function createSenderValidator(
  getMainWindow: () => BrowserWindow | null,
  isAppUrl: AppUrlMatcher,
): (event: IpcMainInvokeEvent) => boolean {
  return (event) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return false;
    if (event.sender.id !== window.webContents.id) return false;

    const frame = event.senderFrame;
    const mainFrame = event.sender.mainFrame;
    if (
      !frame ||
      frame.processId !== mainFrame.processId ||
      frame.routingId !== mainFrame.routingId
    ) {
      return false;
    }
    return isAppUrl(frame.url);
  };
}
