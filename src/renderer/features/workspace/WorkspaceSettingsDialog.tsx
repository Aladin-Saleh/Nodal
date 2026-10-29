import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  ATTACHMENT_MAX_SIZE_LIMIT_BYTES,
  DESCRIPTION_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
} from '../../../shared/domain';
import type { WorkspaceInfo } from '../../../shared/ipc-contract';
import { useClient, useReportError, useRunner } from '../../app/context';
import { Modal } from '../../components/Modal';

const MB = 1024 * 1024;

export interface WorkspaceSettingsDialogProps {
  workspace: WorkspaceInfo;
  onUpdated(workspace: WorkspaceInfo): void;
  /** L'espace a été placé dans la corbeille. */
  onDeleted(): void;
  onClose(): void;
}

/** Nom, description, taille maximale des pièces jointes et suppression (§6.1). */
export function WorkspaceSettingsDialog({
  workspace,
  onUpdated,
  onDeleted,
  onClose,
}: WorkspaceSettingsDialogProps) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const nameId = useId();
  const descriptionId = useId();
  const sizeId = useId();
  const [name, setName] = useState(workspace.name);
  const [description, setDescription] = useState(workspace.description ?? '');
  const [maxSizeMb, setMaxSizeMb] = useState<number | null>(null);

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
