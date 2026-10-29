import type { AppInfo, WorkspaceInfo } from '../../shared/ipc-contract';

export interface StatusBarProps {
  appInfo: AppInfo | null;
  workspace: WorkspaceInfo | null;
}

export function StatusBar({ appInfo, workspace }: StatusBarProps) {
  return (
    <footer className="status-bar" role="contentinfo">
      <span>
        {workspace ? `Espace : ${workspace.name}` : 'Aucun espace ouvert'}
      </span>
      {appInfo && (
        <span
          title={`Electron ${appInfo.electronVersion} · Chromium ${appInfo.chromeVersion} · Node ${appInfo.nodeVersion} · SQLite ${appInfo.sqliteVersion}`}
        >
          {appInfo.appName} v{appInfo.appVersion}
        </span>
      )}
    </footer>
  );
}
