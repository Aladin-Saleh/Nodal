import { useState, type FormEvent } from 'react';
import { RELATION_TYPE_NAME_MAX_LENGTH } from '../../../shared/domain';
import type { RelationTypeInfo } from '../../../shared/model';
import { useClient, useRunner } from '../../app/context';
import { Modal } from '../../components/Modal';

export interface RelationTypeManagerDialogProps {
  relationTypes: RelationTypeInfo[];
  onChanged(): void;
  onClose(): void;
}

/** Ajouter, renommer, colorer et supprimer les types de relations (§13). */
export function RelationTypeManagerDialog({
  relationTypes,
  onChanged,
  onClose,
}: RelationTypeManagerDialogProps) {
  const client = useClient();
  const run = useRunner();
  const [draft, setDraft] = useState('');

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    if (await run(() => client.call('relationType:create', { name }))) {
      setDraft('');
      onChanged();
    }
  };

  const update = async (
    type: RelationTypeInfo,
    changes: { name?: string; color?: string | null },
  ) => {
    if (changes.name !== undefined) {
      const name = changes.name.trim();
      if (!name || name === type.name) return;
      changes = { ...changes, name };
    }
    if (
      await run(() =>
        client.call('relationType:update', { id: type.id, ...changes }),
      )
    ) {
      onChanged();
    }
  };

  const remove = async (type: RelationTypeInfo) => {
    const done = await run(() =>
      client.call('relationType:delete', { id: type.id }),
    );
    if (done !== undefined) onChanged();
  };

  return (
    <Modal
      title="Types de relations"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <ul className="tag-manager">
        {relationTypes.map((type) => (
          <li key={type.id}>
            <input
              type="color"
              aria-label={`Couleur du type ${type.name}`}
              value={type.color ?? '#888888'}
              onChange={(event) =>
                void update(type, { color: event.target.value })
              }
            />
            <input
              type="text"
              aria-label={`Nom du type ${type.name}`}
              defaultValue={type.name}
              maxLength={RELATION_TYPE_NAME_MAX_LENGTH}
              onBlur={(event) =>
                void update(type, { name: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
            <span className="muted">{type.usageCount} relation(s)</span>
            <button
              type="button"
              className="secondary"
              disabled={type.usageCount > 0}
              title={
                type.usageCount > 0
                  ? 'Utilisé par des relations : changez-les ou supprimez-les d’abord.'
                  : 'Supprimer ce type'
              }
              onClick={() => void remove(type)}
            >
              Supprimer
            </button>
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={create}>
        <input
          type="text"
          aria-label="Nouveau type de relation"
          placeholder="Nouveau type de relation…"
          value={draft}
          maxLength={RELATION_TYPE_NAME_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          Ajouter
        </button>
      </form>
    </Modal>
  );
}
