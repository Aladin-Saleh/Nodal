import { useId, useState } from 'react';
import {
  NODE_TYPES,
  NODE_TYPE_LABELS,
  SUMMARY_MAX_LENGTH,
  type NodeType,
} from '../../../shared/domain';
import type {
  NodeDetail,
  NodeSummary,
  RelationTypeInfo,
  TagInfo,
} from '../../../shared/model';
import { useAutosave, useClient, useRunner } from '../../app/context';
import { AttachmentList } from '../attachments/AttachmentList';
import { RelationList } from '../relations/RelationList';
import { TagEditor } from '../tags/TagEditor';

export interface NodePropertiesProps {
  node: NodeDetail;
  allTags: TagInfo[];
  nodes: readonly NodeSummary[];
  relationTypes: readonly RelationTypeInfo[];
  /** Change quand les relations ont été modifiées ailleurs (ex. graphe). */
  relationsRevision: number;
  onNavigate(id: string): void;
  /** Les données du nœud ont changé : recharger la fiche. */
  onNodeChanged(): void;
  /** Les tags de l'espace ont changé. */
  onTagsChanged(): void;
  onRelationsChanged(): void;
}

/**
 * Panneau de propriétés (§7) : type, résumé, couleur, relations, tags,
 * pièces jointes et métadonnées. À remonter (prop `key`) quand le nœud affiché change.
 */
export function NodeProperties({
  node,
  allTags,
  nodes,
  relationTypes,
  relationsRevision,
  onNavigate,
  onNodeChanged,
  onTagsChanged,
  onRelationsChanged,
}: NodePropertiesProps) {
  const client = useClient();
  const run = useRunner();
  const typeId = useId();
  const summaryId = useId();
  const colorId = useId();
  const [summary, setSummary] = useState(node.summary ?? '');

  useAutosave({
    key: `node:${node.id}:summary`,
    value: summary,
    save: (value) =>
      client.call('node:update', { id: node.id, summary: value }),
  });

  const update = async (changes: {
    nodeType?: NodeType;
    color?: string | null;
  }) => {
    if (
      await run(() => client.call('node:update', { id: node.id, ...changes }))
    ) {
      onNodeChanged();
    }
  };

  return (
    <aside className="properties" aria-label="Propriétés du nœud">
      <section>
        <label htmlFor={typeId}>Type</label>
        <select
          id={typeId}
          value={node.nodeType}
          onChange={(event) =>
            void update({ nodeType: event.target.value as NodeType })
          }
        >
          {NODE_TYPES.map((type) => (
            <option key={type} value={type}>
              {NODE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>

        <label htmlFor={summaryId}>Résumé</label>
        <textarea
          id={summaryId}
          rows={4}
          value={summary}
          maxLength={SUMMARY_MAX_LENGTH}
          placeholder="Description courte du nœud"
          onChange={(event) => setSummary(event.target.value)}
        />

        <label htmlFor={colorId}>Couleur</label>
        <div className="inline-form">
          <input
            id={colorId}
            type="color"
            value={node.color ?? '#888888'}
            onChange={(event) => void update({ color: event.target.value })}
          />
          {node.color ? (
            <button
              type="button"
              className="secondary"
              onClick={() => void update({ color: null })}
            >
              Couleur par défaut
            </button>
          ) : (
            <span className="muted">Couleur du type</span>
          )}
        </div>
      </section>

      <section>
        <h3>Relations</h3>
        <RelationList
          key={relationsRevision}
          nodeId={node.id}
          nodes={nodes}
          relationTypes={relationTypes}
          onNavigate={onNavigate}
          onChanged={onRelationsChanged}
        />
      </section>

      <section>
        <h3>Tags</h3>
        <TagEditor
          nodeId={node.id}
          nodeTags={node.tags}
          allTags={allTags}
          onChanged={() => {
            onTagsChanged();
            onNodeChanged();
          }}
        />
      </section>

      <section>
        <h3>Pièces jointes</h3>
        <AttachmentList
          nodeId={node.id}
          attachments={node.attachments}
          onChanged={onNodeChanged}
        />
      </section>

      <section>
        <h3>Informations</h3>
        <dl className="details compact">
          <dt>Sous-nœuds</dt>
          <dd>{node.childCount}</dd>
          <dt>Relations</dt>
          <dd>{node.edgeCount}</dd>
          <dt>Créé le</dt>
          <dd>{new Date(node.createdAt).toLocaleString()}</dd>
          <dt>Modifié le</dt>
          <dd>{new Date(node.updatedAt).toLocaleString()}</dd>
          <dt>Identifiant</dt>
          <dd className="path">{node.id}</dd>
        </dl>
      </section>
    </aside>
  );
}
