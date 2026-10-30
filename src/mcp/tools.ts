/**
 * Lectures exposées aux LLM par le serveur MCP. Chaque fonction retourne des
 * données prêtes à encoder en TOON : les listes sont des tableaux d'objets
 * plats aux mêmes clés, que TOON écrit sous forme de table (une ligne
 * d'en-tête, puis une ligne par élément) au lieu de répéter chaque clé.
 */
import type { NodeType } from '../shared/domain';
import { NodalError } from '../shared/errors';
import { notFound } from '../main/knowledge/context';
import { DocumentService } from '../main/knowledge/document-service';
import { EdgeService } from '../main/knowledge/edge-service';
import { NodeService } from '../main/knowledge/node-service';
import { listRelationTypes } from '../main/knowledge/relation-type-service';
import { assistantCreations } from '../main/knowledge/assistant-origin';
import { asRows } from '../main/knowledge/rows';
import { SearchService } from '../main/knowledge/search-service';
import { TagService } from '../main/knowledge/tag-service';
import type { ReadContext } from './workspace-reader';

export const DEFAULT_MAX_ROWS = 300;
/** Nœuds listés dans les rubriques « hubs » et « recent » de la vue d'ensemble. */
export const OVERVIEW_LIST_SIZE = 10;
export const DEFAULT_DOCUMENT_CHARS = 20_000;
const PATH_SEPARATOR = ' > ';

interface OutlineRow {
  id: string;
  parent_id: string | null;
  title: string;
  node_type: NodeType;
  document_count: number;
}

/** Vue de toute la hiérarchie, chargée une fois par appel. */
interface Outline {
  byId: Map<string, OutlineRow>;
  children: Map<string | null, OutlineRow[]>;
}

function loadOutline(ctx: ReadContext): Outline {
  const rows = asRows<OutlineRow>(
    ctx.db
      .prepare(
        `SELECT n.id, n.parent_id, n.title, n.node_type,
           (SELECT count(*) FROM document d WHERE d.node_id = n.id) AS document_count
         FROM node n WHERE n.workspace_id = ? ORDER BY n.sort_order, n.rowid`,
      )
      .all(ctx.workspaceId),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string | null, OutlineRow[]>();
  for (const row of rows) {
    // Un parent absent (fichier modifié hors de l'app) : traité comme racine.
    const parent =
      row.parent_id && byId.has(row.parent_id) ? row.parent_id : null;
    const list = children.get(parent);
    if (list) list.push(row);
    else children.set(parent, [row]);
  }
  return { byId, children };
}

/** Chemin hiérarchique lisible, de la racine au nœud inclus. */
function pathOf(outline: Outline, id: string): string {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (
    let current = outline.byId.get(id);
    current && !seen.has(current.id);
    current = current.parent_id
      ? outline.byId.get(current.parent_id)
      : undefined
  ) {
    seen.add(current.id);
    titles.unshift(current.title);
  }
  return titles.join(PATH_SEPARATOR);
}

const childCount = (outline: Outline, id: string) =>
  outline.children.get(id)?.length ?? 0;

/** Nombre de descendants (tous niveaux) de chaque nœud, en un seul parcours. */
function descendantCounts(outline: Outline): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    const known = counts.get(id);
    if (known !== undefined) return known;
    let total = 0;
    for (const child of outline.children.get(id) ?? []) {
      // Garde-fou contre un cycle introduit hors de l'application.
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      total += 1 + visit(child.id, seen);
    }
    counts.set(id, total);
    return total;
  };
  for (const id of outline.byId.keys()) visit(id, new Set([id]));
  return counts;
}

/** `assistant` si l'élément a été créé par un assistant IA, sinon `user`. */
const origin = (createdByAssistant: unknown) =>
  createdByAssistant ? 'assistant' : 'user';

/** Les termes trouvés sont encadrés de `**` dans les extraits. */
const markSnippet = (snippet: string) =>
  snippet.replaceAll('\u0002', '**').replaceAll('\u0003', '**');

function count(ctx: ReadContext, sql: string): number {
  return (ctx.db.prepare(sql).get(ctx.workspaceId) as { n: number }).n;
}

export function overview(ctx: ReadContext) {
  const outline = loadOutline(ctx);
  const descendants = descendantCounts(outline);
  return {
    workspace: {
      name: ctx.workspace.name,
      description: ctx.workspace.description,
      updatedAt: ctx.workspace.updated_at,
    },
    stats: {
      nodes: outline.byId.size,
      documents: count(
        ctx,
        'SELECT count(*) AS n FROM document d JOIN node n ON n.id = d.node_id WHERE n.workspace_id = ?',
      ),
      relations: count(
        ctx,
        'SELECT count(*) AS n FROM edge WHERE workspace_id = ?',
      ),
      tags: count(ctx, 'SELECT count(*) AS n FROM tag WHERE workspace_id = ?'),
      nodesByAssistant: count(
        ctx,
        `SELECT count(*) AS n FROM ${assistantCreations('create_node')} c
         JOIN node n ON n.id = c.entity_id WHERE n.workspace_id = ?`,
      ),
      relationsByAssistant: count(
        ctx,
        `SELECT count(*) AS n FROM ${assistantCreations('link')} c
         JOIN edge e ON e.id = c.entity_id WHERE e.workspace_id = ?`,
      ),
    },
    relationTypes: listRelationTypes(ctx).map((type) => ({
      name: type.name,
      usageCount: type.usageCount,
    })),
    tags: new TagService(() => ctx)
      .list()
      .map((tag) => ({ name: tag.name, usageCount: tag.usageCount })),
    roots: (outline.children.get(null) ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      type: row.node_type,
      children: childCount(outline, row.id),
      descendants: descendants.get(row.id) ?? 0,
      documents: row.document_count,
    })),
    // Notions centrales : les plus reliées par des relations transversales.
    hubs: asRows<{ id: string; relations: number }>(
      ctx.db
        .prepare(
          `SELECT id, count(*) AS relations FROM (
             SELECT source_node_id AS id FROM edge WHERE workspace_id = :w
             UNION ALL SELECT target_node_id FROM edge WHERE workspace_id = :w
           ) GROUP BY id ORDER BY relations DESC, id LIMIT :limit`,
        )
        .all({ w: ctx.workspaceId, limit: OVERVIEW_LIST_SIZE }),
    )
      .filter((hub) => outline.byId.has(hub.id))
      .map((hub) => ({
        id: hub.id,
        // Le chemin se termine par le titre : pas de colonne title en double.
        path: pathOf(outline, hub.id),
        relations: hub.relations,
        children: childCount(outline, hub.id),
      })),
    // Activité récente : nœud ou l'un de ses documents modifié.
    recent: asRows<{ id: string; touched: string }>(
      ctx.db
        .prepare(
          `SELECT n.id, max(n.updated_at,
             COALESCE((SELECT max(d.updated_at) FROM document d WHERE d.node_id = n.id), '')) AS touched
           FROM node n WHERE n.workspace_id = ?
           ORDER BY touched DESC, n.rowid DESC LIMIT ?`,
        )
        .all(ctx.workspaceId, OVERVIEW_LIST_SIZE),
    ).map((row) => ({
      id: row.id,
      path: pathOf(outline, row.id),
      updatedAt: row.touched,
    })),
  };
}

export function tree(
  ctx: ReadContext,
  input: { rootId?: string; depth: number; maxRows?: number },
) {
  const outline = loadOutline(ctx);
  const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;
  if (input.rootId && !outline.byId.has(input.rootId)) throw notFound('Nœud');
  const nodes: {
    id: string;
    title: string;
    type: NodeType;
    depth: number;
    children: number;
    documents: number;
  }[] = [];
  let truncated = false;
  // Parcours en profondeur : l'ordre des lignes et la profondeur suffisent à
  // reconstruire l'arbre (le parent d'une ligne est la dernière ligne de
  // profondeur inférieure), d'où l'absence de parentId.
  const visit = (row: OutlineRow, depth: number) => {
    if (nodes.length >= maxRows) {
      truncated = true;
      return;
    }
    nodes.push({
      id: row.id,
      title: row.title,
      type: row.node_type,
      depth,
      children: childCount(outline, row.id),
      documents: row.document_count,
    });
    if (depth >= input.depth) return;
    for (const child of outline.children.get(row.id) ?? [])
      visit(child, depth + 1);
  };
  const start = input.rootId
    ? [outline.byId.get(input.rootId)!]
    : (outline.children.get(null) ?? []);
  for (const row of start) visit(row, 0);
  return {
    root: input.rootId ? pathOf(outline, input.rootId) : null,
    nodes,
    truncated,
  };
}

export function search(
  ctx: ReadContext,
  input: { query: string; limit: number },
) {
  const hits = new SearchService(() => ctx)
    .search(input.query)
    .slice(0, input.limit);
  const outline = loadOutline(ctx);
  return {
    query: input.query,
    nodeCount: hits.length,
    // Une ligne par extrait trouvé (jusqu'à trois par nœud).
    matches: hits.flatMap((hit) =>
      hit.matches.map((match) => ({
        nodeId: hit.nodeId,
        node: hit.nodeTitle,
        type: hit.nodeType,
        path: pathOf(outline, hit.nodeId),
        documentId: match.documentId,
        document: match.documentTitle,
        snippet: markSnippet(match.snippet),
      })),
    ),
  };
}

export function getNode(ctx: ReadContext, id: string) {
  const detail = new NodeService(() => ctx).get(id);
  const outline = loadOutline(ctx);
  return {
    node: {
      id: detail.id,
      title: detail.title,
      type: detail.nodeType,
      path: pathOf(outline, detail.id),
      parentId: detail.parentId,
      summary: detail.summary,
      tags: detail.tags.map((tag) => tag.name).join(', '),
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      createdBy: origin(detail.createdByAssistant),
    },
    documents: detail.documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      contentType: doc.contentType,
      language: doc.language,
      updatedAt: doc.updatedAt,
    })),
    children: (outline.children.get(detail.id) ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      type: row.node_type,
      children: childCount(outline, row.id),
      documents: row.document_count,
    })),
    relations: new EdgeService(() => ctx).listForNode(detail.id).map((rel) => ({
      direction: rel.direction === 'outgoing' ? 'out' : 'in',
      relation: rel.relationTypeName,
      otherId: rel.otherNodeId,
      other: rel.otherNodeTitle,
      label: rel.label,
      by: origin(rel.createdByAssistant),
    })),
    attachments: detail.attachments.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    })),
  };
}

export function readDocument(
  ctx: ReadContext,
  input: { id: string; offset: number; maxChars: number },
) {
  const doc = new DocumentService(() => ctx).get(input.id);
  if (input.offset > doc.body.length) {
    throw new NodalError(
      'VALIDATION_ERROR',
      `Position ${input.offset} au-delà de la fin du document (${doc.body.length} caractères).`,
    );
  }
  const body = doc.body.slice(input.offset, input.offset + input.maxChars);
  const end = input.offset + body.length;
  return {
    header: {
      id: doc.id,
      title: doc.title,
      nodeId: doc.nodeId,
      path: pathOf(loadOutline(ctx), doc.nodeId),
      contentType: doc.contentType,
      language: doc.language,
      updatedAt: doc.updatedAt,
      totalChars: doc.body.length,
      offset: input.offset,
      returnedChars: body.length,
      nextOffset: end < doc.body.length ? end : null,
    },
    body,
  };
}

export function neighborhood(
  ctx: ReadContext,
  input: { nodeId: string; depth: number; maxNodes?: number },
) {
  const outline = loadOutline(ctx);
  if (!outline.byId.has(input.nodeId)) throw notFound('Nœud');
  const maxNodes = input.maxNodes ?? DEFAULT_MAX_ROWS;
  const edges = asRows<{
    source_node_id: string;
    target_node_id: string;
    relation: string;
    label: string | null;
    by_assistant: string | null;
  }>(
    ctx.db
      .prepare(
        `SELECT e.source_node_id, e.target_node_id, rt.name AS relation, e.label,
           origin.entity_id AS by_assistant
         FROM edge e JOIN relation_type rt ON rt.id = e.relation_type_id
         LEFT JOIN ${assistantCreations('link')} origin ON origin.entity_id = e.id
         WHERE e.workspace_id = ? ORDER BY e.rowid`,
      )
      .all(ctx.workspaceId),
  );
  // Voisins : relations dans les deux sens et liens parent-enfant (comme la
  // portée « voisinage » de l'export LLM).
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const edge of edges) {
    link(edge.source_node_id, edge.target_node_id);
    link(edge.target_node_id, edge.source_node_id);
  }
  for (const row of outline.byId.values()) {
    if (row.parent_id && outline.byId.has(row.parent_id)) {
      link(row.id, row.parent_id);
      link(row.parent_id, row.id);
    }
  }

  const distance = new Map([[input.nodeId, 0]]);
  let frontier = [input.nodeId];
  let truncated = false;
  for (let level = 1; level <= input.depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (distance.has(neighbor)) continue;
        if (distance.size >= maxNodes) {
          truncated = true;
          break;
        }
        distance.set(neighbor, level);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  return {
    center: pathOf(outline, input.nodeId),
    nodes: [...distance].map(([id, dist]) => {
      const row = outline.byId.get(id)!;
      return {
        id,
        title: row.title,
        type: row.node_type,
        parentId: row.parent_id,
        distance: dist,
      };
    }),
    relations: edges
      .filter(
        (edge) =>
          distance.has(edge.source_node_id) &&
          distance.has(edge.target_node_id),
      )
      .map((edge) => ({
        sourceId: edge.source_node_id,
        relation: edge.relation,
        targetId: edge.target_node_id,
        label: edge.label,
        by: origin(edge.by_assistant),
      })),
    truncated,
  };
}
