import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  ATTACHMENT_MAX_SIZE_LIMIT_BYTES,
  DESCRIPTION_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
} from '../../../shared/domain';
import type { WorkspaceInfo } from '../../../shared/ipc-contract';
import {
  useClient,
  useReportError,
  useReportInfo,
  useRunner,
} from '../../app/context';
import type { CodeRootInfo } from '../../../shared/code-anchors';
import type { IntegrityReport } from '../../../shared/model';
import { IntegrityReportDialog } from './PortabilityDialogs';
import { Modal } from '../../components/Modal';

const MB = 1024 * 1024;

export interface WorkspaceSettingsDialogProps {
  workspace: WorkspaceInfo;
  onUpdated(workspace: WorkspaceInfo): void;
  /** L'espace a été placé dans la corbeille. */
  onDeleted(): void;
  /** Ouvre les modèles de documents (à la place de cette boîte). */
  onOpenTemplates(): void;
  onClose(): void;
}

/**
 * Nom, description, taille maximale des pièces jointes, dossiers de code
 * (ancrage des nœuds aux fichiers) et suppression (§6.1).
 */
export function WorkspaceSettingsDialog({
  workspace,
  onUpdated,
  onDeleted,
  onOpenTemplates,
  onClose,
}: WorkspaceSettingsDialogProps) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const reportInfo = useReportInfo();
  const [report, setReport] = useState<IntegrityReport | null>(null);

  const backup = async () => {
    const target = await run(() => client.call('workspace:backup'));
    if (target) reportInfo(`Sauvegarde créée : ${target}`);
  };

  const checkIntegrity = async () => {
    const result = await run(() => client.call('workspace:checkIntegrity'));
    if (result) setReport(result);
  };
  const nameId = useId();
  const descriptionId = useId();
  const sizeId = useId();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');
  const [maxSizeMb, setMaxSizeMb] = useState<number | null>(null);
  const [codeRoots, setCodeRoots] = useState<CodeRootInfo[]>([]);

  useEffect(() => {
    client.call('code:getRoots').then(setCodeRoots, reportError);
  }, [client, reportError]);

  // Les dossiers de code sont enregistrés aussitôt (comme la sauvegarde).
  const addCodeRoot = async () => {
    const roots = await run(() => client.call('code:addRoot'));
    if (roots) setCodeRoots(roots);
  };
  const removeCodeRoot = async (path: string) => {
    const roots = await run(() => client.call('code:removeRoot', { path }));
    if (roots) setCodeRoots(roots);
  };

  useEffect(() => {
    client
      .call('workspace:getSettings')
      .then(
        (settings) =>
          setMaxSizeMb(Math.round(settings.attachmentMaxSizeBytes / MB)),
        reportError,
      );
  }, [client, reportError]);

  const maxMb = ATTACHMENT_MAX_SIZE_LIMIT_BYTES / MB;
  const sizeValid = maxSizeMb !== null && maxSizeMb >= 1 && maxSizeMb <= maxMb;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !sizeValid) return;
    const updated = await run(() =>
      client.call('workspace:update', { name: name.trim(), description }),
    );
    if (!updated) return;
    const settings = await run(() =>
      client.call('workspace:updateSettings', {
        attachmentMaxSizeBytes: maxSizeMb * MB,
      }),
    );
    onUpdated(updated);
    if (settings) onClose();
  };

  const remove = async () => {
    // La confirmation est demandée par le main (boîte de dialogue native).
    const deleted = await run(() => client.call('workspace:delete'));
    if (deleted) onDeleted();
  };

  if (report) {
    return (
      <IntegrityReportDialog report={report} onClose={() => setReport(null)} />
    );
  }

  return (
    <Modal title="Paramètres de l’espace" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <label htmlFor={nameId}>Nom</label>
        <input
          id={nameId}
          type="text"
          value={name}
          maxLength={WORKSPACE_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor={descriptionId}>Description</label>
        <textarea
          id={descriptionId}
          rows={3}
          value={description}
          maxLength={DESCRIPTION_MAX_LENGTH}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label htmlFor={sizeId}>Taille maximale par pièce jointe (Mo)</label>
        <input
          id={sizeId}
          type="number"
          min={1}
          max={maxMb}
          value={maxSizeMb ?? ''}
          disabled={maxSizeMb === null}
          onChange={(event) =>
            setMaxSizeMb(Number.parseInt(event.target.value, 10) || 0)
          }
        />
        <p className="muted path">{workspace.filePath}</p>

        <fieldset className="choices">
          <legend>Dossiers de code</legend>
          <p className="muted">
            Les nœuds peuvent être ancrés à des fichiers de ces dossiers (ex.
            src/mcp/**) : Nodal signale alors la documentation dont le code a
            changé depuis. Chemins locaux, non exportés.
          </p>
          {codeRoots.length > 0 && (
            <ul className="code-roots">
              {codeRoots.map((root) => (
                <li key={root.path}>
                  <span className="path">{root.path}</span>
                  {!root.exists && (
                    <span className="anchor-missing">introuvable</span>
                  )}
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`Retirer le dossier ${root.path}`}
                    onClick={() => void removeCodeRoot(root.path)}
                  >
                    Retirer
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="inline-form">
            <button
              type="button"
              className="secondary"
              onClick={() => void addCodeRoot()}
            >
              Ajouter un dossier…
            </button>
          </div>
        </fieldset>

        <fieldset className="choices">
          <legend>Modèles de documents</legend>
          <p className="muted">
            Procédure, composant, donnée, décision (ADR)… proposés à la création
            d’un nœud ou d’un document.
          </p>
          <div className="inline-form">
            <button
              type="button"
              className="secondary"
              onClick={onOpenTemplates}
            >
              Modifier les modèles…
            </button>
          </div>
        </fieldset>

        <fieldset className="choices">
          <legend>Maintenance</legend>
          <div className="inline-form">
            <button
              type="button"
              className="secondary"
              onClick={() => void backup()}
            >
              Créer une sauvegarde…
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void checkIntegrity()}
            >
              Vérifier l’intégrité
            </button>
          </div>
        </fieldset>

        <div className="modal-footer">
          <button
            type="button"
            className="danger left"
            onClick={() => void remove()}
          >
            Supprimer l’espace…
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" disabled={!name.trim() || !sizeValid}>
            Enregistrer
          </button>
        </div>
      </form>
    </Modal>
  );
}
