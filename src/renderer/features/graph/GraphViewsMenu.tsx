import { useId, useState, type FormEvent } from 'react';
import { GRAPH_VIEW_NAME_MAX_LENGTH } from '../../../shared/domain';
import type { GraphCamera } from '../../../shared/model';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { ContextMenuItem } from '../../components/ContextMenu';
import { MenuButton } from '../../components/MenuButton';
import { Modal } from '../../components/Modal';
import type { GraphViewsApi } from '../workspace/useGraphViewPersistence';

/** Saisie du nom d'une vue (nouvelle vue ou renommage). */
function ViewNameDialog({
  title,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: string;
  submitLabel: string;
  onSubmit(name: string): void;
  onCancel(): void;
}) {
  const nameId = useId();
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <Modal title={title} onClose={onCancel}>
      <form className="form" onSubmit={submit}>
        <label htmlFor={nameId}>Nom de la vue</label>
        <input
          id={nameId}
          type="text"
          value={name}
          maxLength={GRAPH_VIEW_NAME_MAX_LENGTH}
          data-autofocus
          onChange={(event) => setName(event.target.value)}
        />
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" disabled={!trimmed}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Dialog = { kind: 'create' } | { kind: 'rename' } | { kind: 'delete' };

/**
 * Vues graphe enregistrées : sélecteur (appliquer une vue) et menu « Vues »
 * (enregistrer, mettre à jour, renommer, vue par défaut, supprimer).
 */
export function GraphViewsMenu({
  api,
  getCamera,
}: {
  api: GraphViewsApi;
  /** Caméra courante du graphe, enregistrée avec la vue. */
  getCamera(): GraphCamera | null;
}) {
  const selectId = useId();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { views, active, modified } = api;
  const items: ContextMenuItem[] = [
    {
      label: 'Enregistrer comme nouvelle vue…',
      onSelect: () => setDialog({ kind: 'create' }),
    },
  ];
  if (active) {
    items.push(
      {
        label: `Mettre à jour « ${active.name} »`,
        separator: true,
        onSelect: () => void api.update(active.id, getCamera()),
      },
      {
        label: `Renommer « ${active.name} »…`,
        onSelect: () => setDialog({ kind: 'rename' }),
      },
      active.isDefault
        ? {
            label: 'Ne plus ouvrir cette vue par défaut',
            onSelect: () => void api.setDefault(null),
          }
        : {
            label: 'Ouvrir cette vue avec l’espace',
            onSelect: () => void api.setDefault(active.id),
          },
      {
        label: `Supprimer « ${active.name} »…`,
        danger: true,
        onSelect: () => setDialog({ kind: 'delete' }),
      },
    );
  }

  return (
    <div className="graph-views">
      <label htmlFor={selectId} className="visually-hidden">
        Vue enregistrée
      </label>
      <select
        id={selectId}
        value={active?.id ?? ''}
        onChange={(event) => {
          if (event.target.value) api.apply(event.target.value);
        }}
        title={
          modified ? 'La vue affichée diffère de la vue enregistrée' : undefined
        }
      >
        <option value="" disabled>
          {views.length === 0 ? 'Aucune vue enregistrée' : 'Vue…'}
        </option>
        {views.map((view) => (
          <option key={view.id} value={view.id}>
            {view.isDefault ? `${view.name} ★` : view.name}
          </option>
        ))}
      </select>
      {modified && (
        <span className="graph-view-modified muted" aria-live="polite">
          modifiée
        </span>
      )}
      <MenuButton
        label="Gérer les vues"
        title="Une vue garde la portée, les filtres, les nœuds masqués et repliés et la position de la caméra. ★ : vue ouverte avec l’espace."
        items={items}
      >
        Vues
      </MenuButton>

      {dialog?.kind === 'create' && (
        <ViewNameDialog
          title="Enregistrer la vue"
          initial=""
          submitLabel="Enregistrer"
          onCancel={() => setDialog(null)}
          onSubmit={(name) =>
            void api.create(name, getCamera()).then((done) => {
              if (done) setDialog(null);
            })
          }
        />
      )}
      {dialog?.kind === 'rename' && active && (
        <ViewNameDialog
          title="Renommer la vue"
          initial={active.name}
          submitLabel="Renommer"
          onCancel={() => setDialog(null)}
          onSubmit={(name) =>
            void api.rename(active.id, name).then((done) => {
              if (done) setDialog(null);
            })
          }
        />
      )}
      {dialog?.kind === 'delete' && active && (
        <ConfirmDialog
          title="Supprimer la vue"
          confirmLabel="Supprimer"
          danger
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null);
            void api.remove(active.id);
          }}
        >
          <p>
            Supprimer la vue « {active.name} » ? Les nœuds et les réglages
            affichés ne changent pas.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
