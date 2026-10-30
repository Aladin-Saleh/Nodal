import type { AppInfo, WorkspaceInfo } from '../../shared/ipc-contract';
import type { SaveStatus } from '../services/save-tracker';
import { useSaveState } from './context';

const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: 'Enregistré',
  pending: 'Modifications en attente…',
  saving: 'Enregistrement…',
  error: 'Erreur d’enregistrement',
};

export interface StatusBarProps {
  appInfo: AppInfo | null;
  workspace: WorkspaceInfo | null;
  onOpenPreferences(): void;
}

/** Barre d'état (§7) : espace actif, état de sauvegarde, version. */
export function StatusBar({
  appInfo,
  workspace,
  onOpenPreferences,
}: StatusBarProps) {
  const save = useSaveState();
  return (
    <footer className="status-bar" role="contentinfo">
      <span>
        {workspace ? `Espace : ${workspace.name}` : 'Aucun espace ouvert'}
      </span>
      {workspace && (
        <span
          role="status"
          className={`save-status save-${save.status}`}
          title={save.error ?? undefined}
        >
          {SAVE_LABELS[save.status]}
          {save.error ? ` : ${save.error}` : ''}
        </span>
      )}
      <span className="status-end">
        <button
          type="button"
          className="ghost status-button"
          title="Préférences (Ctrl+,)"
          onClick={onOpenPreferences}
        >
          Préférences
        </button>
        {appInfo && (
          <span
            title={`Electron ${appInfo.electronVersion} · Chromium ${appInfo.chromeVersion} · Node ${appInfo.nodeVersion} · SQLite ${appInfo.sqliteVersion}`}
          >
            {appInfo.appName} v{appInfo.appVersion}
          </span>
        )}
      </span>
    </footer>
  );
}
