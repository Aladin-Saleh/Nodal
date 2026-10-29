import type { WorkspaceInfo } from '../../shared/ipc-contract';

export interface WorkspaceViewProps {
  workspace: WorkspaceInfo;
  busy: boolean;
  onClose(): void;
}

export function WorkspaceView({
  workspace,
  busy,
  onClose,
}: WorkspaceViewProps) {
  return (
    <section className="workspace" aria-labelledby="workspace-title">
      <header className="workspace-header">
        <h1 id="workspace-title">{workspace.name}</h1>
        <button type="button" disabled={busy} onClick={onClose}>
          Fermer l’espace
        </button>
      </header>
      <dl className="details">
        <dt>Fichier</dt>
        <dd className="path">{workspace.filePath}</dd>
        <dt>Version du schéma</dt>
        <dd>{workspace.schemaVersion}</dd>
        <dt>Créé le</dt>
        <dd>{new Date(workspace.createdAt).toLocaleString()}</dd>
      </dl>
    </section>
  );
}
