import {
  EVIDENCE_MAX_PER_EDGE,
  EVIDENCE_QUOTE_MAX_LENGTH,
  EVIDENCE_SOURCE_MAX_LENGTH,
  type Confidence,
  type EdgeEvidence,
} from '../../shared/evidence';
import { NodalError } from '../../shared/errors';
import { redactSecrets } from '../../shared/secrets';
import type {
  CreateEdgeInput,
  UpdateEdgeInput,
} from '../../shared/ipc-contract';
import type { EdgeInfo, NodeRelation } from '../../shared/model';
import { notFound, type ContextProvider, type ServiceContext } from './context';
import { assistantCreations, toAssistantOrigin } from './assistant-origin';
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
  from_link: number;
  confidence: Confidence | null;
}

const EDGE_COLUMNS =
  'e.id, e.source_node_id, e.target_node_id, e.relation_type_id, e.label, e.description, e.created_at, e.updated_at, e.from_link, e.confidence';

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
    ...(row.from_link === 1 && { fromLink: true }),
    ...(row.confidence && { confidence: row.confidence }),
  };
}

interface EvidenceRow {
  id: string;
  edge_id: string;
  source: string;
  quote: string | null;
  verified: number | null;
  client: string | null;
  created_at: string;
}

/** Complète des relations par leurs preuves, dans l'ordre d'ajout. */
function withEvidence<T extends EdgeInfo>(
  ctx: ServiceContext,
  edges: T[],
): T[] {
  if (edges.length === 0) return edges;
  const byEdge = new Map<string, EdgeEvidence[]>();
  for (const row of asRows<EvidenceRow>(
    ctx.db
      .prepare(
        `SELECT v.* FROM edge_evidence v JOIN edge e ON e.id = v.edge_id
         WHERE e.workspace_id = ? ORDER BY v.rowid`,
      )
      .all(ctx.workspaceId),
  )) {
    const item: EdgeEvidence = {
      id: row.id,
      source: row.source,
      quote: row.quote,
      verified: row.verified === null ? null : row.verified === 1,
      client: row.client,
      createdAt: row.created_at,
    };
    const list = byEdge.get(row.edge_id);
    if (list) list.push(item);
    else byEdge.set(row.edge_id, [item]);
  }
  return edges.map((edge) => {
    const evidence = byEdge.get(edge.id);
    return evidence ? { ...edge, evidence } : edge;
  });
}

/** Relation d'un type entre deux nœuds, si elle existe. */
export function findEdge(
  ctx: ServiceContext,
  sourceId: string,
  targetId: string,
  relationTypeId: string,
): EdgeInfo | null {
  const row = asRow<EdgeRow>(
    ctx.db
      .prepare(
        `SELECT ${EDGE_COLUMNS} FROM edge e
         WHERE e.source_node_id = ? AND e.target_node_id = ?
           AND e.relation_type_id = ? AND e.workspace_id = ?`,
      )
      .get(sourceId, targetId, relationTypeId, ctx.workspaceId),
  );
  return row ? toEdgeInfo(row) : null;
}

/**
 * Ajoute une preuve à une relation ; `null` si elle y est déjà. Les secrets
 * reconnaissables sont masqués.
 */
export function addEvidence(
  ctx: ServiceContext,
  edgeId: string,
  input: Pick<EdgeEvidence, 'source' | 'quote' | 'verified' | 'client'>,
): string | null {
  const source = redactSecrets(input.source).trim();
  const quote = redactSecrets(input.quote ?? '').trim() || null;
  if (
    !source ||
    source.length > EVIDENCE_SOURCE_MAX_LENGTH ||
    (quote?.length ?? 0) > EVIDENCE_QUOTE_MAX_LENGTH
  ) {
    throw new NodalError(
      'VALIDATION_ERROR',
      `Preuve : source de 1 à ${EVIDENCE_SOURCE_MAX_LENGTH} caractères, citation de ${EVIDENCE_QUOTE_MAX_LENGTH} au plus.`,
    );
  }
  const known = asRows<{ source: string; quote: string | null }>(
    ctx.db
      .prepare('SELECT source, quote FROM edge_evidence WHERE edge_id = ?')
      .all(edgeId),
  );
  if (known.some((item) => item.source === source && item.quote === quote))
    return null;
  if (known.length >= EVIDENCE_MAX_PER_EDGE) {
    throw new NodalError(
      'LIMIT_EXCEEDED',
      `${EVIDENCE_MAX_PER_EDGE} preuves au plus par relation.`,
    );
  }
  const id = ctx.newId();
  ctx.db
    .prepare(
      `INSERT INTO edge_evidence (id, edge_id, source, quote, verified, client, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      edgeId,
      source,
      quote,
      input.verified === null ? null : Number(input.verified),
      input.client,
      ctx.now(),
    );
  return id;
}

/** Change la confiance d'une relation, sans autre effet. */
export function setConfidence(
  ctx: ServiceContext,
  edgeId: string,
  confidence: Confidence | null,
): void {
  ctx.db
    .prepare('UPDATE edge SET confidence = ?, updated_at = ? WHERE id = ?')
    .run(confidence, ctx.now(), edgeId);
}

export function listEdges(ctx: ServiceContext): EdgeInfo[] {
  const edges = asRows<EdgeRow>(
    ctx.db
      .prepare(
        `SELECT ${EDGE_COLUMNS} FROM edge e WHERE e.workspace_id = ? ORDER BY e.rowid`,
      )
      .all(ctx.workspaceId),
  ).map(toEdgeInfo);
  return withEvidence(ctx, edges);
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
      EdgeRow & {
        other_id: string;
        other_title: string;
        type_name: string;
        origin_at: string | null;
        origin_client: string | null;
      }
    >(
      ctx.db
        .prepare(
          `SELECT ${EDGE_COLUMNS},
             CASE WHEN e.source_node_id = :id THEN e.target_node_id ELSE e.source_node_id END AS other_id,
             n.title AS other_title, rt.name AS type_name,
             origin.created_at AS origin_at, origin.client AS origin_client
           FROM edge e
           JOIN relation_type rt ON rt.id = e.relation_type_id
           LEFT JOIN ${assistantCreations('link')} origin ON origin.entity_id = e.id
           JOIN node n ON n.id = CASE WHEN e.source_node_id = :id THEN e.target_node_id ELSE e.source_node_id END
           WHERE e.source_node_id = :id OR e.target_node_id = :id
           ORDER BY rt.name COLLATE NOCASE, n.title COLLATE NOCASE`,
        )
        .all({ id: nodeId }),
    );
    const relations = rows.map((row): NodeRelation => ({
      ...toEdgeInfo(row),
      direction: row.source_node_id === nodeId ? 'outgoing' : 'incoming',
      otherNodeId: row.other_id,
      otherNodeTitle: row.other_title,
      relationTypeName: row.type_name,
      createdByAssistant: toAssistantOrigin(row),
    }));
    return withEvidence(ctx, relations);
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
        `INSERT INTO edge (id, workspace_id, source_node_id, target_node_id, relation_type_id, label, description, created_at, updated_at, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.confidence ?? null,
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
        // Retouchée à la main : elle ne suit plus le lien qui l'a créée.
        `UPDATE edge SET relation_type_id = ?, label = ?, description = ?, confidence = ?, updated_at = ?, from_link = 0
         WHERE id = ?`,
      )
      .run(
        relationTypeId,
        input.label === undefined ? current.label : input.label,
        input.description === undefined
          ? current.description
          : input.description,
        input.confidence === undefined
          ? (current.confidence ?? null)
          : input.confidence,
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
