import { NodalError } from '../../shared/errors';
import type {
  CreateEdgeInput,
  UpdateEdgeInput,
} from '../../shared/ipc-contract';
import type { EdgeInfo, NodeRelation } from '../../shared/model';
import { notFound, type ContextProvider, type ServiceContext } from './context';
import { getRelationType } from './relation-type-service';
import { asRow, asRows } from './rows';

interface EdgeRow {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type_id: string;
  label: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

const EDGE_COLUMNS =
  'e.id, e.source_node_id, e.target_node_id, e.relation_type_id, e.label, e.description, e.created_at, e.updated_at';

function toEdgeInfo(row: EdgeRow): EdgeInfo {
  return {
    id: row.id,
    sourceId: row.source_node_id,
    targetId: row.target_node_id,
    relationTypeId: row.relation_type_id,
    label: row.label,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listEdges(ctx: ServiceContext): EdgeInfo[] {
  return asRows<EdgeRow>(
    ctx.db
      .prepare(
        `SELECT ${EDGE_COLUMNS} FROM edge e WHERE e.workspace_id = ? ORDER BY e.rowid`,
      )
      .all(ctx.workspaceId),
  ).map(toEdgeInfo);
}

function getEdge(ctx: ServiceContext, id: string): EdgeInfo {
  const found = asRow<EdgeRow>(
    ctx.db
      .prepare(
        `SELECT ${EDGE_COLUMNS} FROM edge e WHERE e.id = ? AND e.workspace_id = ?`,
      )
      .get(id, ctx.workspaceId),
  );
  if (!found) throw notFound('Relation');
  return toEdgeInfo(found);
}

function assertNodeExists(ctx: ServiceContext, id: string): void {
  const found = ctx.db
    .prepare('SELECT 1 FROM node WHERE id = ? AND workspace_id = ?')
    .get(id, ctx.workspaceId);
  if (!found) throw notFound('Nœud');
}

function assertNotDuplicate(
  ctx: ServiceContext,
  sourceId: string,
  targetId: string,
  relationTypeId: string,
  exceptId: string | null,
): void {
  const duplicate = ctx.db
    .prepare(
      `SELECT 1 FROM edge WHERE source_node_id = ? AND target_node_id = ?
       AND relation_type_id = ? AND id IS NOT ?`,
    )
    .get(sourceId, targetId, relationTypeId, exceptId);
  if (duplicate) {
    throw new NodalError(
      'CONFLICT',
      'Cette relation existe déjà entre ces deux nœuds.',
    );
  }
}

/**
 * Relations transversales (§6.8) : indépendantes de la hiérarchie,
 * modifiables et supprimables sans toucher aux nœuds.
 */
export class EdgeService {
  constructor(private readonly context: ContextProvider) {}

  /** Relations sortantes et entrantes d'un nœud. */
  listForNode(nodeId: string): NodeRelation[] {
    const ctx = this.context();
    assertNodeExists(ctx, nodeId);
    const rows = asRows<
      EdgeRow & { other_id: string; other_title: string; type_name: string }
    >(
      ctx.db
        .prepare(
          `SELECT ${EDGE_COLUMNS},
             CASE WHEN e.source_node_id = :id THEN e.target_node_id ELSE e.source_node_id END AS other_id,
             n.title AS other_title, rt.name AS type_name
           FROM edge e
           JOIN relation_type rt ON rt.id = e.relation_type_id
           JOIN node n ON n.id = CASE WHEN e.source_node_id = :id THEN e.target_node_id ELSE e.source_node_id END
           WHERE e.source_node_id = :id OR e.target_node_id = :id
           ORDER BY rt.name COLLATE NOCASE, n.title COLLATE NOCASE`,
        )
        .all({ id: nodeId }),
    );
    return rows.map((row) => ({
      ...toEdgeInfo(row),
      direction: row.source_node_id === nodeId ? 'outgoing' : 'incoming',
      otherNodeId: row.other_id,
      otherNodeTitle: row.other_title,
      relationTypeName: row.type_name,
    }));
  }

  create(input: CreateEdgeInput): EdgeInfo {
    const ctx = this.context();
    assertNodeExists(ctx, input.sourceId);
    assertNodeExists(ctx, input.targetId);
    getRelationType(ctx, input.relationTypeId);
    if (input.sourceId === input.targetId) {
      throw new NodalError(
        'CONFLICT',
        'Un nœud ne peut pas être relié à lui-même.',
      );
    }
    assertNotDuplicate(
      ctx,
      input.sourceId,
      input.targetId,
      input.relationTypeId,
      null,
    );
    const id = ctx.newId();
    const timestamp = ctx.now();
    ctx.db
      .prepare(
        `INSERT INTO edge (id, workspace_id, source_node_id, target_node_id, relation_type_id, label, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        ctx.workspaceId,
        input.sourceId,
        input.targetId,
        input.relationTypeId,
        input.label ?? null,
        input.description ?? null,
        timestamp,
        timestamp,
      );
    return getEdge(ctx, id);
  }

  update(input: UpdateEdgeInput): EdgeInfo {
    const ctx = this.context();
    const current = getEdge(ctx, input.id);
    const relationTypeId = input.relationTypeId ?? current.relationTypeId;
    if (input.relationTypeId !== undefined) {
      getRelationType(ctx, input.relationTypeId);
      assertNotDuplicate(
        ctx,
        current.sourceId,
        current.targetId,
        relationTypeId,
        input.id,
      );
    }
    ctx.db
      .prepare(
        `UPDATE edge SET relation_type_id = ?, label = ?, description = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        relationTypeId,
        input.label === undefined ? current.label : input.label,
        input.description === undefined
          ? current.description
          : input.description,
        ctx.now(),
        input.id,
      );
    return getEdge(ctx, input.id);
  }

  delete(id: string): void {
    const ctx = this.context();
    getEdge(ctx, id);
    ctx.db.prepare('DELETE FROM edge WHERE id = ?').run(id);
  }
}
