import { TITLE_MAX_LENGTH } from '../../shared/domain';
import { NodalError } from '../../shared/errors';
import type {
  CreateNodeInput,
  DeleteNodeInput,
  DuplicateNodeInput,
  MoveNodeInput,
  SetNodeTagsInput,
  UpdateNodeInput,
} from '../../shared/ipc-contract';
import type {
  DeletionCounts,
  NodeDeletionImpact,
  NodeDetail,
  NodePathItem,
  NodeSummary,
  TagInfo,
} from '../../shared/model';
import { inTransaction } from '../database/transaction';
import { listNodeAttachments } from './attachment-service';
import { notFound, type ContextProvider, type ServiceContext } from './context';
import { listNodeDocuments } from './document-service';
import {
  NODE_COLUMNS,
  asRow,
  asRows,
  toNodeSummary,
  type DocumentRow,
  type NodeRow,
} from './rows';
import { listNodeTags } from './tag-service';

/** Garde-fou contre une hiérarchie corrompue (cycle introduit hors de l'app). */
const MAX_DEPTH = 10_000;
const COPY_SUFFIX = ' (copie)';
const COPY_OFFSET = 40;

function getNodeRow(ctx: ServiceContext, id: string): NodeRow {
  const found = asRow<NodeRow>(
    ctx.db
      .prepare(
        `SELECT ${NODE_COLUMNS} FROM node WHERE id = ? AND workspace_id = ?`,
      )
      .get(id, ctx.workspaceId),
  );
  if (!found) throw notFound('Nœud');
  return found;
}

/** Identifiants de tous les descendants (hors le nœud lui-même). */
export function descendantIds(ctx: ServiceContext, id: string): string[] {
  return asRows<{ id: string }>(
    ctx.db
      .prepare(
        `WITH RECURSIVE sub(id, depth) AS (
           SELECT id, 1 FROM node WHERE parent_id = ?
           UNION
           SELECT n.id, sub.depth + 1 FROM node n JOIN sub ON n.parent_id = sub.id
           WHERE sub.depth < ${MAX_DEPTH}
         )
         SELECT DISTINCT id FROM sub`,
      )
      .all(id),
  ).map((entry) => entry.id);
}

function ancestorPath(ctx: ServiceContext, id: string): NodePathItem[] {
  return asRows<NodePathItem>(
    ctx.db
      .prepare(
        `WITH RECURSIVE anc(id, parent_id, title, depth) AS (
           SELECT id, parent_id, title, 0 FROM node WHERE id = ?
           UNION
           SELECT n.id, n.parent_id, n.title, anc.depth + 1
           FROM node n JOIN anc ON n.id = anc.parent_id
           WHERE anc.depth < ${MAX_DEPTH}
         )
         SELECT id, title FROM anc WHERE depth > 0 ORDER BY depth DESC`,
      )
      .all(id),
  );
}

function siblingIds(ctx: ServiceContext, parentId: string | null): string[] {
  return asRows<{ id: string }>(
    ctx.db
      .prepare(
        `SELECT id FROM node WHERE workspace_id = ? AND parent_id IS ?
         ORDER BY sort_order, rowid`,
      )
      .all(ctx.workspaceId, parentId),
  ).map((entry) => entry.id);
}

function writeSiblingOrder(ctx: ServiceContext, ids: string[]): void {
  const update = ctx.db.prepare('UPDATE node SET sort_order = ? WHERE id = ?');
  ids.forEach((id, index) => update.run(index, id));
}

/** Paramètre JSON pour `IN (SELECT value FROM json_each(?))` : sans limite de taille. */
const jsonIds = (ids: readonly string[]) => JSON.stringify(ids);

function countsFor(ctx: ServiceContext, nodeIds: string[]): DeletionCounts {
  const ids = jsonIds(nodeIds);
  const count = (sql: string, ...params: string[]) =>
    (ctx.db.prepare(sql).get(...params) as { n: number }).n;
  return {
    documentCount: count(
      'SELECT count(*) AS n FROM document WHERE node_id IN (SELECT value FROM json_each(?))',
      ids,
    ),
    attachmentCount: count(
      `SELECT count(*) AS n FROM attachment
       WHERE node_id IN (SELECT value FROM json_each(?))
          OR document_id IN (SELECT id FROM document WHERE node_id IN (SELECT value FROM json_each(?)))`,
      ids,
      ids,
    ),
    edgeCount: count(
      `SELECT count(*) AS n FROM edge
       WHERE source_node_id IN (SELECT value FROM json_each(?))
          OR target_node_id IN (SELECT value FROM json_each(?))`,
      ids,
      ids,
    ),
  };
}

/** Supprime des nœuds avec leurs documents, pièces jointes et relations. */
function deleteNodes(ctx: ServiceContext, nodeIds: string[]): void {
  const ids = jsonIds(nodeIds);
  const inIds = 'IN (SELECT value FROM json_each(?))';
  const { db } = ctx;
  db.prepare(
    `DELETE FROM edge WHERE source_node_id ${inIds} OR target_node_id ${inIds}`,
  ).run(ids, ids);
  db.prepare(
    `DELETE FROM attachment WHERE node_id ${inIds}
       OR document_id IN (SELECT id FROM document WHERE node_id ${inIds})`,
  ).run(ids, ids);
  db.prepare(`DELETE FROM document WHERE node_id ${inIds}`).run(ids);
  // Les clés parent sont en RESTRICT : détacher d'abord, puis supprimer.
  db.prepare(`UPDATE node SET parent_id = NULL WHERE id ${inIds}`).run(ids);
  db.prepare(`DELETE FROM node WHERE id ${inIds}`).run(ids);
}

/**
 * Nœuds et hiérarchie (§6.2). Les identifiants sont conservés lors d'un
 * renommage ou d'un déplacement ; les relations transversales ne sont jamais
 * modifiées par un déplacement.
 */
export class NodeService {
  constructor(private readonly context: ContextProvider) {}

  /** Vue légère de tous les nœuds, pour l'arborescence. */
  list(): NodeSummary[] {
    const ctx = this.context();
    return asRows<NodeRow>(
      ctx.db
        .prepare(
          `SELECT ${NODE_COLUMNS} FROM node WHERE workspace_id = ?
           ORDER BY sort_order, rowid`,
        )
        .all(ctx.workspaceId),
    ).map(toNodeSummary);
  }

  get(id: string): NodeDetail {
    const ctx = this.context();
    const node = getNodeRow(ctx, id);
    const count = (sql: string, ...params: string[]) =>
      (ctx.db.prepare(sql).get(...params) as { n: number }).n;
    return {
      ...toNodeSummary(node),
      summary: node.summary,
      createdAt: node.created_at,
      updatedAt: node.updated_at,
      path: ancestorPath(ctx, id),
      tags: listNodeTags(ctx, id),
      documents: listNodeDocuments(ctx, id),
      attachments: listNodeAttachments(ctx, id),
      childCount: count(
        'SELECT count(*) AS n FROM node WHERE parent_id = ?',
        id,
      ),
      edgeCount: count(
        'SELECT count(*) AS n FROM edge WHERE source_node_id = ? OR target_node_id = ?',
        id,
        id,
      ),
    };
  }

  create(input: CreateNodeInput): NodeSummary {
    const ctx = this.context();
    if (input.parentId !== null) getNodeRow(ctx, input.parentId);
    const id = ctx.newId();
    const timestamp = ctx.now();
    ctx.db
      .prepare(
        `INSERT INTO node (id, workspace_id, parent_id, title, node_type, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?,
           (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM node WHERE workspace_id = ? AND parent_id IS ?),
           ?, ?)`,
      )
      .run(
        id,
        ctx.workspaceId,
        input.parentId,
        input.title,
        input.nodeType,
        ctx.workspaceId,
        input.parentId,
        timestamp,
        timestamp,
      );
    return toNodeSummary(getNodeRow(ctx, id));
  }

  update(input: UpdateNodeInput): NodeSummary {
    const ctx = this.context();
    const current = getNodeRow(ctx, input.id);
    const pick = <K extends 'summary' | 'color'>(
      value: NodeRow[K] | undefined,
      key: K,
    ) => (value === undefined ? current[key] : value);
    ctx.db
      .prepare(
        `UPDATE node SET title = ?, node_type = ?, summary = ?, color = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.title ?? current.title,
        input.nodeType ?? current.node_type,
        pick(input.summary, 'summary'),
        pick(input.color, 'color'),
        ctx.now(),
        input.id,
      );
    return toNodeSummary(getNodeRow(ctx, input.id));
  }

  /**
   * Déplace un nœud sous un nouveau parent (ou à la racine), à la position
   * `index` parmi ses nouveaux frères. Refuse tout cycle (§5.4).
   */
  move(input: MoveNodeInput): void {
    const ctx = this.context();
    const node = getNodeRow(ctx, input.id);
    if (input.parentId !== null) {
      getNodeRow(ctx, input.parentId);
      if (
        input.parentId === input.id ||
        descendantIds(ctx, input.id).includes(input.parentId)
      ) {
        throw new NodalError(
          'CONFLICT',
          'Un nœud ne peut pas être déplacé sous lui-même ou sous l’un de ses descendants.',
        );
      }
    }

    inTransaction(ctx.db, () => {
      const siblings = siblingIds(ctx, input.parentId).filter(
        (id) => id !== input.id,
      );
      const index = Math.min(input.index ?? siblings.length, siblings.length);
      siblings.splice(index, 0, input.id);
      if (node.parent_id !== input.parentId) {
        ctx.db
          .prepare('UPDATE node SET parent_id = ?, updated_at = ? WHERE id = ?')
          .run(input.parentId, ctx.now(), input.id);
        writeSiblingOrder(
          ctx,
          siblingIds(ctx, node.parent_id).filter((id) => id !== input.id),
        );
      }
      writeSiblingOrder(ctx, siblings);
    });
  }

  /**
   * Duplique un nœud (documents, tags et pièces jointes compris), placé juste
   * après l'original. Les relations transversales ne sont pas dupliquées.
   */
  duplicate(input: DuplicateNodeInput): NodeSummary {
    const ctx = this.context();
    const original = getNodeRow(ctx, input.id);
    const copyId = inTransaction(ctx.db, () => {
      const id = this.copyNode(ctx, original, original.parent_id, true);
      const siblings = siblingIds(ctx, original.parent_id).filter(
        (sibling) => sibling !== id,
      );
      siblings.splice(siblings.indexOf(original.id) + 1, 0, id);
      writeSiblingOrder(ctx, siblings);
      if (input.includeChildren) this.copyChildren(ctx, original.id, id);
      return id;
    });
    return toNodeSummary(getNodeRow(ctx, copyId));
  }

  getDeletionImpact(id: string): NodeDeletionImpact {
    const ctx = this.context();
    getNodeRow(ctx, id);
    const descendants = descendantIds(ctx, id);
    return {
      childCount: siblingIds(ctx, id).length,
      descendantCount: descendants.length,
      node: countsFor(ctx, [id]),
      subtree: countsFor(ctx, [id, ...descendants]),
    };
  }

  /**
   * Supprime un nœud, ses documents, pièces jointes et relations, selon une
   * stratégie explicite pour ses enfants (§5.4). La confirmation est demandée
   * par l'interface à partir de `getDeletionImpact`.
   */
  delete(input: DeleteNodeInput): void {
    const ctx = this.context();
    const node = getNodeRow(ctx, input.id);
    inTransaction(ctx.db, () => {
      if (input.childrenStrategy === 'delete') {
        deleteNodes(ctx, [input.id, ...descendantIds(ctx, input.id)]);
        return;
      }
      // Les enfants prennent la place du nœud supprimé parmi ses frères.
      const children = siblingIds(ctx, input.id);
      const siblings = siblingIds(ctx, node.parent_id);
      siblings.splice(siblings.indexOf(input.id), 1, ...children);
      const reparent = ctx.db.prepare(
        'UPDATE node SET parent_id = ?, updated_at = ? WHERE id = ?',
      );
      const timestamp = ctx.now();
      for (const child of children) {
        reparent.run(node.parent_id, timestamp, child);
      }
      deleteNodes(ctx, [input.id]);
      writeSiblingOrder(ctx, siblings);
    });
  }

  setTags(input: SetNodeTagsInput): TagInfo[] {
    const ctx = this.context();
    getNodeRow(ctx, input.id);
    const tagIds = [...new Set(input.tagIds)];
    const known = (
      ctx.db
        .prepare(
          'SELECT count(*) AS n FROM tag WHERE workspace_id = ? AND id IN (SELECT value FROM json_each(?))',
        )
        .get(ctx.workspaceId, jsonIds(tagIds)) as { n: number }
    ).n;
    if (known !== tagIds.length) throw notFound('Tag');

    inTransaction(ctx.db, () => {
      ctx.db.prepare('DELETE FROM node_tag WHERE node_id = ?').run(input.id);
      const insert = ctx.db.prepare(
        'INSERT INTO node_tag (node_id, tag_id) VALUES (?, ?)',
      );
      for (const tagId of tagIds) insert.run(input.id, tagId);
      ctx.db
        .prepare('UPDATE node SET updated_at = ? WHERE id = ?')
        .run(ctx.now(), input.id);
    });
    return listNodeTags(ctx, input.id);
  }

  /** Copie un nœud, ses documents, pièces jointes et tags ; retourne le nouvel id. */
  private copyNode(
    ctx: ServiceContext,
    source: NodeRow,
    parentId: string | null,
    isRoot: boolean,
  ): string {
    const id = ctx.newId();
    const timestamp = ctx.now();
    ctx.db
      .prepare(
        `INSERT INTO node (id, workspace_id, parent_id, title, node_type, summary, color, position_x, position_y, position_z, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        ctx.workspaceId,
        parentId,
        isRoot ? copyTitle(source.title) : source.title,
        source.node_type,
        source.summary,
        source.color,
        offset(source.position_x),
        offset(source.position_y),
        source.position_z,
        source.sort_order,
        timestamp,
        timestamp,
      );

    const documents = asRows<DocumentRow>(
      ctx.db
        .prepare(
          'SELECT id FROM document WHERE node_id = ? ORDER BY sort_order, rowid',
        )
        .all(source.id),
    );
    const copyDocument = ctx.db.prepare(
      `INSERT INTO document (id, node_id, title, content_type, language, body, sort_order, created_at, updated_at)
       SELECT ?, ?, title, content_type, language, body, sort_order, ?, ? FROM document WHERE id = ?`,
    );
    // Le BLOB est copié par SQLite, sans transiter par la mémoire du process.
    const copyAttachment = ctx.db.prepare(
      `INSERT INTO attachment (id, node_id, document_id, file_name, data, mime_type, size_bytes, checksum, created_at)
       SELECT ?, ?, ?, file_name, data, mime_type, size_bytes, checksum, ? FROM attachment WHERE id = ?`,
    );
    const attachmentsOf = (
      column: 'node_id' | 'document_id',
      ownerId: string,
    ) =>
      asRows<{ id: string }>(
        ctx.db
          .prepare(
            `SELECT id FROM attachment WHERE ${column} = ? ORDER BY rowid`,
          )
          .all(ownerId),
      );

    for (const document of documents) {
      const documentId = ctx.newId();
      copyDocument.run(documentId, id, timestamp, timestamp, document.id);
      for (const attachment of attachmentsOf('document_id', document.id)) {
        copyAttachment.run(
          ctx.newId(),
          null,
          documentId,
          timestamp,
          attachment.id,
        );
      }
    }
    for (const attachment of attachmentsOf('node_id', source.id)) {
      copyAttachment.run(ctx.newId(), id, null, timestamp, attachment.id);
    }
    ctx.db
      .prepare(
        'INSERT INTO node_tag (node_id, tag_id) SELECT ?, tag_id FROM node_tag WHERE node_id = ?',
      )
      .run(id, source.id);
    return id;
  }

  private copyChildren(
    ctx: ServiceContext,
    sourceParentId: string,
    targetParentId: string,
  ): void {
    const children = asRows<NodeRow>(
      ctx.db
        .prepare(
          `SELECT ${NODE_COLUMNS} FROM node WHERE parent_id = ? ORDER BY sort_order, rowid`,
        )
        .all(sourceParentId),
    );
    for (const child of children) {
      const copyId = this.copyNode(ctx, child, targetParentId, false);
      this.copyChildren(ctx, child.id, copyId);
    }
  }
}

function offset(value: number | null): number | null {
  return value === null ? null : value + COPY_OFFSET;
}

function copyTitle(title: string): string {
  return `${title.slice(0, TITLE_MAX_LENGTH - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
}
