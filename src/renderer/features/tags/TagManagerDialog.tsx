import { useState } from 'react';
import { TAG_NAME_MAX_LENGTH } from '../../../shared/domain';
import type { TagInfo } from '../../../shared/model';
import { useClient, useRunner } from '../../app/context';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';

export interface TagManagerDialogProps {
  tags: TagInfo[];
  onChanged(): void;
  onClose(): void;
}

/** Renommer, colorer et supprimer les tags de l'espace. */
export function TagManagerDialog({
  tags,
  onChanged,
  onClose,
}: TagManagerDialogProps) {
  const client = useClient();
  const run = useRunner();
  const [pendingDelete, setPendingDelete] = useState<TagInfo | null>(null);

  const update = async (
    tag: TagInfo,
    changes: { name?: string; color?: string | null },
  ) => {
    if (changes.name !== undefined) {
      const name = changes.name.trim();
      if (!name || name === tag.name) return;
      changes = { ...changes, name };
    }
    if (
      await run(() => client.call('tag:update', { id: tag.id, ...changes }))
    ) {
      onChanged();
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const tag = pendingDelete;
    setPendingDelete(null);
    const done = await run(() => client.call('tag:delete', { id: tag.id }));
    if (done !== undefined) onChanged();
  };

  if (pendingDelete) {
    return (
      <ConfirmDialog
        title={`Supprimer le tag « ${pendingDelete.name} » ?`}
        confirmLabel="Supprimer le tag"
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          {pendingDelete.usageCount > 0
            ? `Il sera retiré de ${pendingDelete.usageCount} nœud(s). Les nœuds eux-mêmes sont conservés.`
            : 'Ce tag n’est utilisé par aucun nœud.'}
        </p>
      </ConfirmDialog>
    );
  }

  return (
    <Modal
      title="Tags de l’espace"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      {tags.length === 0 ? (
        <p className="muted">
          Aucun tag. Ajoutez-en depuis le panneau de propriétés d’un nœud.
        </p>
      ) : (
        <ul className="tag-manager">
          {tags.map((tag) => (
            <li key={tag.id}>
              <input
                type="color"
                aria-label={`Couleur du tag ${tag.name}`}
                value={tag.color ?? '#888888'}
                onChange={(event) =>
                  void update(tag, { color: event.target.value })
                }
              />
              <input
                type="text"
                aria-label={`Nom du tag ${tag.name}`}
                defaultValue={tag.name}
                maxLength={TAG_NAME_MAX_LENGTH}
                onBlur={(event) =>
                  void update(tag, { name: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
              <span className="muted">{tag.usageCount} nœud(s)</span>
              <button
                type="button"
                className="secondary"
                onClick={() => setPendingDelete(tag)}
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
