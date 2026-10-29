import { useId, useState, type FormEvent } from 'react';
import {
  NODE_TYPES,
  NODE_TYPE_LABELS,
  TITLE_MAX_LENGTH,
  type NodeType,
} from '../../../shared/domain';
import type {
  ChildrenStrategy,
  NodeDeletionImpact,
  NodeSummary,
} from '../../../shared/model';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { subtreeIds, visibleRows, type TreeIndex } from './tree';

export function NewNodeDialog({
  parentTitle,
  onSubmit,
  onCancel,
}: {
  parentTitle: string | null;
  onSubmit(title: string, nodeType: NodeType): void;
  onCancel(): void;
}) {
  const titleId = useId();
  const typeId = useId();
  const [title, setTitle] = useState('');
  const [nodeType, setNodeType] = useState<NodeType>('concept');
  const trimmed = title.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed, nodeType);
  };

  return (
    <Modal
      title={
        parentTitle
          ? `Nouveau nœud dans « ${parentTitle} »`
          : 'Nouveau nœud racine'
      }
      onClose={onCancel}
    >
      <form className="form" onSubmit={submit}>
        <label htmlFor={titleId}>Titre</label>
        <input
          id={titleId}
          type="text"
          value={title}
          maxLength={TITLE_MAX_LENGTH}
          data-autofocus
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor={typeId}>Type</label>
        <select
          id={typeId}
          value={nodeType}
          onChange={(event) => setNodeType(event.target.value as NodeType)}
        >
          {NODE_TYPES.map((type) => (
            <option key={type} value={type}>
              {NODE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" disabled={!trimmed}>
            Créer
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MoveNodeDialog({
  index,
  node,
  onSubmit,
  onCancel,
}: {
  index: TreeIndex;
  node: NodeSummary;
  onSubmit(parentId: string | null): void;
  onCancel(): void;
}) {
  const selectId = useId();
  const forbidden = subtreeIds(index, node.id);
  // Toute l'arborescence dépliée, sans le nœud ni ses descendants.
  const targets = visibleRows(index, new Set(index.byId.keys())).filter(
    (row) => !forbidden.has(row.node.id),
  );
  const [parentId, setParentId] = useState<string>(node.parentId ?? '');

  return (
    <Modal
      title={`Déplacer « ${node.title} »`}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="secondary" onClick={onCancel}>
            Annuler
          </button>
          <button
            type="button"
            disabled={(node.parentId ?? '') === parentId}
            onClick={() => onSubmit(parentId === '' ? null : parentId)}
          >
            Déplacer
          </button>
        </>
      }
    >
      <label htmlFor={selectId}>Nouveau parent</label>
      <select
        id={selectId}
        value={parentId}
        data-autofocus
        onChange={(event) => setParentId(event.target.value)}
      >
        <option value="">(Racine de l’espace)</option>
        {targets.map((row) => (
          <option key={row.node.id} value={row.node.id}>
            {`${' '.repeat(row.depth)}${row.node.title}`}
          </option>
        ))}
      </select>
      <p className="muted">
        Le nœud garde son identifiant, ses documents et ses relations.
      </p>
    </Modal>
  );
}

export function DuplicateNodeDialog({
  node,
  hasChildren,
  onSubmit,
  onCancel,
}: {
  node: NodeSummary;
  hasChildren: boolean;
  onSubmit(includeChildren: boolean): void;
  onCancel(): void;
}) {
  const checkboxId = useId();
  const [includeChildren, setIncludeChildren] = useState(false);
  return (
    <ConfirmDialog
      title={`Dupliquer « ${node.title} »`}
      confirmLabel="Dupliquer"
      onConfirm={() => onSubmit(includeChildren)}
      onCancel={onCancel}
    >
      <p>
        La copie reprend les documents, tags et pièces jointes. Les relations du
        graphe ne sont pas dupliquées.
      </p>
      {hasChildren && (
        <label className="checkbox" htmlFor={checkboxId}>
          <input
            id={checkboxId}
            type="checkbox"
            checked={includeChildren}
            onChange={(event) => setIncludeChildren(event.target.checked)}
          />
          Dupliquer aussi les sous-nœuds
        </label>
      )}
    </ConfirmDialog>
  );
}

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count > 1 ? pluralForm : singular}`;

export function DeleteNodeDialog({
  node,
  impact,
  busy,
  onSubmit,
  onCancel,
}: {
  node: NodeSummary;
  impact: NodeDeletionImpact;
  busy: boolean;
  onSubmit(strategy: ChildrenStrategy): void;
  onCancel(): void;
}) {
  const name = useId();
  const [strategy, setStrategy] = useState<ChildrenStrategy>('reparent');
  const counts = strategy === 'delete' ? impact.subtree : impact.node;
  const lost = [
    strategy === 'delete' && impact.descendantCount > 0
      ? plural(impact.descendantCount, 'sous-nœud', 'sous-nœuds')
      : null,
    counts.documentCount > 0
      ? plural(counts.documentCount, 'document', 'documents')
      : null,
    counts.attachmentCount > 0
      ? plural(counts.attachmentCount, 'pièce jointe', 'pièces jointes')
      : null,
    counts.edgeCount > 0
      ? plural(counts.edgeCount, 'relation', 'relations')
      : null,
  ].filter((entry): entry is string => entry !== null);

  return (
    <ConfirmDialog
      title={`Supprimer « ${node.title} » ?`}
      confirmLabel="Supprimer définitivement"
      danger
      busy={busy}
      onConfirm={() => onSubmit(strategy)}
      onCancel={onCancel}
    >
      {impact.childCount > 0 && (
        <fieldset className="choices">
          <legend>
            Ce nœud a {plural(impact.childCount, 'enfant', 'enfants')}. Que
            faire de {impact.childCount > 1 ? 'ses enfants' : 'son enfant'} ?
          </legend>
          <label>
            <input
              type="radio"
              name={name}
              checked={strategy === 'reparent'}
              onChange={() => setStrategy('reparent')}
            />
            Les remonter d’un niveau (ils sont conservés)
          </label>
          <label>
            <input
              type="radio"
              name={name}
              checked={strategy === 'delete'}
              onChange={() => setStrategy('delete')}
            />
            Les supprimer avec tout le sous-arbre
          </label>
        </fieldset>
      )}
      <p>
        {lost.length > 0
          ? `Seront aussi supprimés : ${lost.join(', ')}.`
          : 'Ce nœud ne contient ni document, ni pièce jointe, ni relation.'}
      </p>
      <p className="muted">Cette action est irréversible.</p>
    </ConfirmDialog>
  );
}
