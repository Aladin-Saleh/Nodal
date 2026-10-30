import { useCallback, useEffect, useState } from 'react';
import type {
  NodeRelation,
  NodeSummary,
  RelationTypeInfo,
} from '../../../shared/model';
import { useClient, useReportError, useRunner } from '../../app/context';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { AssistantBadge } from '../workspace/AssistantBadge';
import { RelationDialog, type RelationFormValue } from './RelationDialog';

export interface RelationListProps {
  nodeId: string;
  nodes: readonly NodeSummary[];
  relationTypes: readonly RelationTypeInfo[];
  onNavigate(id: string): void;
  onChanged(): void;
}

type Editing =
  | { kind: 'create' }
  | { kind: 'edit'; relation: NodeRelation }
  | { kind: 'delete'; relation: NodeRelation };

/**
 * Relations sortantes et entrantes du nœud (§7, panneau droit). À remonter
 * (prop `key`) quand les relations ont changé ailleurs.
 */
export function RelationList({
  nodeId,
  nodes,
  relationTypes,
  onNavigate,
  onChanged,
}: RelationListProps) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const [relations, setRelations] = useState<NodeRelation[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);

  const load = useCallback(
    () =>
      client
        .call('edge:listForNode', { id: nodeId })
        .then(setRelations, reportError),
    [client, nodeId, reportError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const afterChange = () => {
    void load();
    onChanged();
  };

  const submit = async (value: RelationFormValue) => {
    const current = editing;
    setEditing(null);
    const result =
      current?.kind === 'edit'
        ? await run(() =>
            client.call('edge:update', {
              id: current.relation.id,
              relationTypeId: value.relationTypeId,
              label: value.label,
              description: value.description,
            }),
          )
        : await run(() => client.call('edge:create', value));
    if (result) afterChange();
  };

  const remove = async (relation: NodeRelation) => {
    setEditing(null);
    const done = await run(() =>
      client.call('edge:delete', { id: relation.id }),
    );
    if (done !== undefined) afterChange();
  };

  const outgoing = relations.filter(
    (relation) => relation.direction === 'outgoing',
  );
  const incoming = relations.filter(
    (relation) => relation.direction === 'incoming',
  );

  const renderGroup = (title: string, items: NodeRelation[]) =>
    items.length > 0 && (
      <div className="relation-group">
        <h4>{title}</h4>
        <ul className="relation-list">
          {items.map((relation) => (
            <li key={relation.id}>
              <span
                className="relation-type"
                title={relation.description ?? undefined}
              >
                {relation.label ?? relation.relationTypeName}
              </span>
              <button
                type="button"
                className="link-button relation-target"
                onClick={() => onNavigate(relation.otherNodeId)}
              >
                {relation.otherNodeTitle}
              </button>
              <AssistantBadge
                origin={relation.createdByAssistant}
                what="Relation créée"
              />
              <button
                type="button"
                className="link-button"
                aria-label={`Modifier la relation vers ${relation.otherNodeTitle}`}
                title="Modifier"
                onClick={() => setEditing({ kind: 'edit', relation })}
              >
                ✎
              </button>
              <button
                type="button"
                className="link-button"
                aria-label={`Supprimer la relation vers ${relation.otherNodeTitle}`}
                title="Supprimer"
                onClick={() => setEditing({ kind: 'delete', relation })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="relations">
      {relations.length === 0 && <p className="muted">Aucune relation.</p>}
      {renderGroup('Sortantes', outgoing)}
      {renderGroup('Entrantes', incoming)}
      <button
        type="button"
        className="secondary"
        disabled={nodes.length < 2}
        onClick={() => setEditing({ kind: 'create' })}
      >
        + Relation
      </button>

      {editing?.kind === 'create' && (
        <RelationDialog
          title="Nouvelle relation"
          nodes={nodes}
          relationTypes={relationTypes}
          initial={{ sourceId: nodeId }}
          submitLabel="Créer la relation"
          onSubmit={(value) => void submit(value)}
          onCancel={() => setEditing(null)}
        />
      )}
      {editing?.kind === 'edit' && (
        <RelationDialog
          title="Modifier la relation"
          nodes={nodes}
          relationTypes={relationTypes}
          initial={{
            sourceId: editing.relation.sourceId,
            targetId: editing.relation.targetId,
            relationTypeId: editing.relation.relationTypeId,
            label: editing.relation.label,
            description: editing.relation.description,
          }}
          lockEnds
          submitLabel="Enregistrer"
          onSubmit={(value) => void submit(value)}
          onCancel={() => setEditing(null)}
        />
      )}
      {editing?.kind === 'delete' && (
        <ConfirmDialog
          title="Supprimer la relation ?"
          confirmLabel="Supprimer la relation"
          danger
          onConfirm={() => void remove(editing.relation)}
          onCancel={() => setEditing(null)}
        >
          <p>
            La relation «{' '}
            {editing.relation.label ?? editing.relation.relationTypeName} » avec
            « {editing.relation.otherNodeTitle} » sera supprimée. Les deux nœuds
            sont conservés.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
