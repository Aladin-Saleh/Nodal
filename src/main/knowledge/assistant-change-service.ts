/**
 * Journal des modifications d'un assistant IA (serveur MCP) : chaque écriture
 * est enregistrée dans la même transaction qu'elle, avec l'état avant et
 * après. L'application liste ces entrées et peut les annuler, à condition que
 * l'élément n'ait pas été modifié depuis (sinon l'annulation écraserait un
 * travail plus récent).
 */
import type { AssistantAction, NodeType } from '../../shared/domain';
import { NodalError } from '../../shared/errors';
import type { AssistantChange } from '../../shared/model';
import { inTransaction } from '../database/transaction';
import { notFound, type ContextProvider, type ServiceContext } from './context';
import { DocumentService } from './document-service';
import { EdgeService } from './edge-service';
import { NodeService } from './node-service';
import { asRow, asRows } from './rows';
import { listNodeTags } from './tag-service';

/** Champs d'un nœud modifiables par l'assistant. */
export interface NodeState {
  title: string;
  nodeType: NodeType;
  summary: string | null;
  parentId: string | null;
}

export interface DocumentState {
  title: string;
  body: string;
}

/** États avant / après enregistrés pour chaque type de modification. */
export interface ChangeStates {
  create_node: { before: null; after: { id: string } };
  update_node: { before: NodeState; after: NodeState };
  create_document: { before: null; after: DocumentState };
  update_document: { before: DocumentState; after: DocumentState };
  link: { before: null; after: { edgeId: string } };
  tag: { before: { tagIds: string[] }; after: { tagIds: string[] } };
}

export type ChangeEntry = {
  [A in AssistantAction]: {
    action: A;
    nodeId: string;
    entityId: string;
    summary: string;
    client: string | null;
  } & ChangeStates[A];
}[AssistantAction];

const DEFAULT_LIST_LIMIT = 200;

/** Enregistre une modification (à appeler dans la transaction de l'écriture). */
export function recordAssistantChange(
  ctx: ServiceContext,
  entry: ChangeEntry,
): string {
  const id = ctx.newId();
  ctx.db
    .prepare(
      `INSERT INTO assistant_change
         (id, workspace_id, created_at, client, action, node_id, entity_id, summary, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ctx.workspaceId,
      ctx.now(),
      entry.client,
      entry.action,
      entry.nodeId,
      entry.entityId,
      entry.summary,
      entry.before === null ? null : JSON.stringify(entry.before),
      JSON.stringify(entry.after),
    );
  return id;
}

/** État courant d'un nœud, dans la forme du journal ; `null` s'il n'existe plus. */
export function readNodeState(
  ctx: ServiceContext,
  id: string,
): NodeState | null {
  const row = asRow<{
    title: string;
    node_type: NodeType;
    summary: string | null;
    parent_id: string | null;
  }>(
    ctx.db
      .prepare(
        'SELECT title, node_type, summary, parent_id FROM node WHERE id = ? AND workspace_id = ?',
      )
      .get(id, ctx.workspaceId),
  );
  return row
    ? {
        title: row.title,
        nodeType: row.node_type,
        summary: row.summary,
        parentId: row.parent_id,
      }
    : null;
}

export function readDocumentState(
  ctx: ServiceContext,
  id: string,
): DocumentState | null {
  const row = asRow<{ title: string; body: string }>(
    ctx.db
      .prepare(
        `SELECT d.title, d.body FROM document d JOIN node n ON n.id = d.node_id
         WHERE d.id = ? AND n.workspace_id = ?`,
      )
      .get(id, ctx.workspaceId),
  );
  return row ?? null;
}

interface ChangeRow {
  id: string;
  created_at: string;
  client: string | null;
  action: AssistantAction;
  node_id: string | null;
  node_title: string | null;
  entity_id: string;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  undone_at: string | null;
  validated_at?: string | null;
}

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

const sortedIds = (ids: string[]) => [...ids].toSorted();

function modifiedSince(what: string): NodalError {
  return new NodalError(
    'CONFLICT',
    `${what} a été modifié depuis : l’annulation écraserait des changements plus récents.`,
  );
}

export class AssistantChangeService {
  constructor(private readonly context: ContextProvider) {}

  list(limit = DEFAULT_LIST_LIMIT): AssistantChange[] {
    const ctx = this.context();
    return asRows<ChangeRow>(
      ctx.db
        .prepare(
          `SELECT c.id, c.created_at, c.client, c.action, c.node_id, n.title AS node_title,
             c.entity_id, c.summary, c.before_json, c.after_json, c.undone_at,
             c.validated_at
           FROM assistant_change c
           LEFT JOIN node n ON n.id = c.node_id AND n.workspace_id = c.workspace_id
           WHERE c.workspace_id = ?
           ORDER BY c.created_at DESC, c.rowid DESC
           LIMIT ?`,
        )
        .all(ctx.workspaceId, limit),
    ).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      client: row.client,
      action: row.action,
      nodeId: row.node_title === null ? null : row.node_id,
      nodeTitle: row.node_title,
      summary: row.summary,
      undoneAt: row.undone_at,
      validatedAt: row.validated_at ?? null,
    }));
  }

  /**
   * Valide des nœuds ajoutés par l'assistant : ils ne sont plus présentés
   * comme « ajoutés par l'IA ». L'historique est conservé. Renvoie le nombre
   * de nœuds validés (ceux qui ne l'étaient pas déjà).
   */
  validateNodes(ids: readonly string[]): number {
    const ctx = this.context();
    const validate = ctx.db.prepare(
      `UPDATE assistant_change SET validated_at = ?
       WHERE workspace_id = ? AND action = 'create_node' AND entity_id = ?
         AND undone_at IS NULL AND validated_at IS NULL`,
    );
    let count = 0;
    inTransaction(ctx.db, () => {
      const now = ctx.now();
      for (const id of new Set(ids)) {
        count += Number(validate.run(now, ctx.workspaceId, id).changes);
      }
    });
    return count;
  }

  /** Rétablit l'état d'avant la modification, si rien ne l'a touchée depuis. */
  undo(id: string): void {
    const ctx = this.context();
    const row = asRow<ChangeRow>(
      ctx.db
        .prepare(
          `SELECT id, action, entity_id, before_json, after_json, undone_at
           FROM assistant_change WHERE id = ? AND workspace_id = ?`,
        )
        .get(id, ctx.workspaceId),
    );
    if (!row) throw notFound('Modification');
    if (row.undone_at) {
      throw new NodalError('CONFLICT', 'Cette modification est déjà annulée.');
    }
    const before: unknown = row.before_json && JSON.parse(row.before_json);
    const after: unknown = row.after_json && JSON.parse(row.after_json);
    const provider = () => ctx;
    inTransaction(ctx.db, () => {
      switch (row.action) {
        case 'create_node':
          this.undoCreateNode(ctx, row.entity_id);
          break;
        case 'update_node': {
          const previous = before as NodeState;
          const current = readNodeState(ctx, row.entity_id);
          if (!current) throw notFound('Nœud');
          if (!sameJson(current, after)) throw modifiedSince('Le nœud');
          const nodes = new NodeService(provider);
          nodes.update({
            id: row.entity_id,
            title: previous.title,
            nodeType: previous.nodeType,
            summary: previous.summary,
          });
          if (current.parentId !== previous.parentId) {
            nodes.move({ id: row.entity_id, parentId: previous.parentId });
          }
          break;
        }
        case 'create_document': {
          const current = readDocumentState(ctx, row.entity_id);
          if (!current) throw notFound('Document');
          if (!sameJson(current, after)) throw modifiedSince('Le document');
          new DocumentService(provider).delete(row.entity_id);
          break;
        }
        case 'update_document': {
          const current = readDocumentState(ctx, row.entity_id);
          if (!current) throw notFound('Document');
          if (!sameJson(current, after)) throw modifiedSince('Le document');
          new DocumentService(provider).update({
            id: row.entity_id,
            ...(before as DocumentState),
          });
          break;
        }
        case 'link':
          new EdgeService(provider).delete(row.entity_id);
          break;
        case 'tag': {
          const current = listNodeTags(ctx, row.entity_id).map((tag) => tag.id);
          const { tagIds: expected } = after as { tagIds: string[] };
          if (!sameJson(sortedIds(current), sortedIds(expected))) {
            throw modifiedSince('Les tags du nœud');
          }
          // Un tag supprimé entre-temps ne peut pas être remis.
          const existing = new Set(
            asRows<{ id: string }>(
              ctx.db
                .prepare('SELECT id FROM tag WHERE workspace_id = ?')
                .all(ctx.workspaceId),
            ).map((tag) => tag.id),
          );
          new NodeService(provider).setTags({
            id: row.entity_id,
            tagIds: (before as { tagIds: string[] }).tagIds.filter((tagId) =>
              existing.has(tagId),
            ),
          });
          break;
        }
      }
      ctx.db
        .prepare('UPDATE assistant_change SET undone_at = ? WHERE id = ?')
        .run(ctx.now(), row.id);
    });
  }

  /** Un nœud créé n'est retiré que s'il est resté vide (rien n'en dépend). */
  private undoCreateNode(ctx: ServiceContext, nodeId: string): void {
    if (!readNodeState(ctx, nodeId)) throw notFound('Nœud');
    const used = ctx.db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM node WHERE parent_id = :id)
             OR EXISTS (SELECT 1 FROM document WHERE node_id = :id)
             OR EXISTS (SELECT 1 FROM attachment WHERE node_id = :id)
             OR EXISTS (SELECT 1 FROM edge WHERE source_node_id = :id OR target_node_id = :id)
           AS used`,
      )
      .get({ id: nodeId }) as { used: number };
    if (used.used) {
      throw new NodalError(
        'CONFLICT',
        'Ce nœud a reçu depuis des enfants, des documents ou des relations : annulez d’abord ces ajouts, ou supprimez-le vous-même.',
      );
    }
    new NodeService(() => ctx).delete({
      id: nodeId,
      childrenStrategy: 'reparent',
    });
  }
}
