/**
 * Lectures exposées aux LLM par le serveur MCP. Chaque fonction retourne des
 * données prêtes à encoder en TOON : les listes sont des tableaux d'objets
 * plats aux mêmes clés, que TOON écrit sous forme de table (une ligne
 * d'en-tête, puis une ligne par élément) au lieu de répéter chaque clé.
 */
import type { ContentType, NodeType } from '../shared/domain';
import type { SearchHit } from '../shared/model';
import { chunkDocument } from '../main/knowledge/chunking';
import { NodalError } from '../shared/errors';
import { notFound } from '../main/knowledge/context';
import { DocumentService } from '../main/knowledge/document-service';
import { EdgeService } from '../main/knowledge/edge-service';
import { NodeService } from '../main/knowledge/node-service';
import { listRelationTypes } from '../main/knowledge/relation-type-service';
import { listBacklinks } from '../main/knowledge/link-service';
import { healthReport } from '../main/knowledge/health-service';
import { assistantCreations } from '../main/knowledge/assistant-origin';
import { asRows } from '../main/knowledge/rows';
import { SearchService } from '../main/knowledge/search-service';
import { TagService } from '../main/knowledge/tag-service';
import { listLessons } from '../main/knowledge/lesson-service';
import {
  currentLessons,
  nodeVerdict,
  type Lesson,
  type LessonOutcome,
} from '../shared/lessons';
import { readAnalysisGraph } from '../main/knowledge/analysis-service';
import {
  bridges,
  connections,
  dependencyCycles,
  redundantRelations,
  suggestedQuestions,
} from '../shared/graph-analysis';
import {
  IMPACT_DEFAULT_DEPTH,
  impactDirection,
  impactOf,
  isVagueRelation,
} from '../shared/graph-impact';
import { confidenceRank, type Confidence } from '../shared/evidence';
import { foldText } from '../shared/text';
import {
  findShortestPath,
  PATH_DEFAULT_DEPTH,
  PATH_MAX_DEPTH,
  type PathGraphEdge,
  type PathLink,
  type PathStep,
} from '../shared/graph-path';
import { toRootRelative, type StaleNode } from '../shared/code-anchors';
import {
  PATHS_CASE_INSENSITIVE,
  listAnchoredNodes,
  listAnchors,
  nodesForPaths,
  readCodeRoots,
  resolveCodeRoots,
  withSnapshots,
  type AnchoredNode,
} from '../main/knowledge/anchor-service';
import type { ReadContext } from './workspace-reader';

export const DEFAULT_MAX_ROWS = 300;
/** Nœuds listés dans les rubriques « hubs » et « recent » de la vue d'ensemble. */
export const OVERVIEW_LIST_SIZE = 10;
export const DEFAULT_DOCUMENT_CHARS = 20_000;
/** Contenu de documents renvoyé par défaut par une recherche (~3 000 tokens). */
export const DEFAULT_SEARCH_CHARS = 12_000;
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

/** Chemins de plusieurs nœuds d'un même appel. */
export function nodePaths(ctx: ReadContext): (id: string) => string {
  const outline = loadOutline(ctx);
  return (id) => pathOf(outline, id);
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
  let total = 0;
  // Parcours en profondeur : l'ordre des lignes et la profondeur suffisent à
  // reconstruire l'arbre (le parent d'une ligne est la dernière ligne de
  // profondeur inférieure), d'où l'absence de parentId.
  const visit = (row: OutlineRow, depth: number) => {
    // Au-delà de la limite, les lignes sont seulement comptées.
    if (++total <= maxRows) {
      nodes.push({
        id: row.id,
        title: row.title,
        type: row.node_type,
        depth,
        children: childCount(outline, row.id),
        documents: row.document_count,
      });
    }
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
    truncated: total > maxRows,
    ...(total > maxRows ? { maxRowsNeeded: total } : {}),
  };
}

/** En dessous, un document trouvé (ou court, pour nodal_get_node) est renvoyé en entier. */
export const SHORT_DOCUMENT_CHARS = 2_000;
/** Contenu des documents courts inclus au plus par nodal_get_node. */
export const GET_NODE_INLINE_CHARS = 6_000;
/** Taille visée des sections d'un long document (tokens estimés). */
const SECTION_TOKENS = 400;
/** Estimation grossière (≈ 4 caractères par token) : suffit pour découper. */
const estimateTokens = (text: string) => Math.ceil(text.length / 4);
/** Une section trop longue pour le budget restant n'est tronquée qu'au-delà. */
const MIN_TRUNCATED_CHARS = 300;

/** Section d'un long document qui contient des mots cherchés. */
export interface FoundSection {
  /** Chemin de titres (Markdown), chemin JSON, ou `null`. */
  section: string | null;
  /** Position dans le document, pour lire la suite avec nodal_read_document. */
  offset: number | null;
  content: string;
}

/** Document trouvé : entier s'il est court, sinon ses sections pertinentes. */
export interface FoundDocument {
  id: string;
  title: string;
  path: string;
  contentType: string;
  language: string | null;
  totalChars: number;
  /** Document court : contenu entier. */
  body: string | null;
  sections: FoundSection[];
}

export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mots cherchés, en préfixes sans accents (comme la recherche plein texte). */
export function termPatterns(query: string): RegExp[] {
  const words = normalize(query).match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(words)].map(
    (word) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(word)}`, 'u'),
  );
}

/** Sections d'un document, avec leur position quand elle se retrouve. */
function sectionsOf(doc: {
  body: string;
  contentType: ContentType;
  language: string | null;
}): FoundSection[] {
  let cursor = 0;
  return chunkDocument(
    doc.body,
    doc.contentType,
    doc.language,
    SECTION_TOKENS,
    estimateTokens,
  ).map((piece) => {
    // Les fragments reprennent le texte d'origine (paragraphes rognés) : leur
    // début se retrouve dans le document, dans l'ordre.
    const head = piece.content.slice(0, 60);
    const found = doc.body.indexOf(head, cursor);
    if (found >= 0) cursor = found + head.length;
    return {
      section: piece.section,
      offset: found >= 0 ? found : null,
      content: piece.content,
    };
  });
}

/**
 * Sections d'un long document qui contiennent le plus de mots cherchés
 * (titres de section compris) — à égalité, toutes —, dans la limite de
 * `budget` caractères, remises dans l'ordre du document ; `chars` : la taille
 * de toutes ces sections, retenues ou non.
 */
function matchingSections(
  sections: FoundSection[],
  patterns: RegExp[],
  budget: number,
): { sections: FoundSection[]; chars: number } {
  const scored = sections
    .map((section, index) => {
      const haystack = normalize(
        `${section.section ?? ''}\n${section.content}`,
      );
      return {
        section,
        index,
        score: patterns.filter((pattern) => pattern.test(haystack)).length,
      };
    })
    .filter((entry) => entry.score > 0);
  // Seulement les meilleures sections : un mot présent partout (le titre du
  // document répété dans chaque chemin de section, par exemple) ne suffit pas.
  const best = Math.max(0, ...scored.map((entry) => entry.score));
  const ranked = scored.filter((entry) => entry.score === best);
  const chosen: { section: FoundSection; index: number }[] = [];
  let used = 0;
  for (const entry of ranked) {
    const remaining = budget - used;
    if (entry.section.content.length <= remaining) {
      chosen.push(entry);
      used += entry.section.content.length;
    } else if (chosen.length === 0 && remaining >= MIN_TRUNCATED_CHARS) {
      // La meilleure section ne tient pas : son début, plutôt que rien.
      chosen.push({
        ...entry,
        section: {
          ...entry.section,
          content: `${entry.section.content.slice(0, remaining - 1)}…`,
        },
      });
      break;
    }
  }
  return {
    sections: chosen
      .toSorted((a, b) => a.index - b.index)
      .map((entry) => entry.section),
    chars: ranked.reduce((sum, entry) => sum + entry.section.content.length, 0),
  };
}

/**
 * Recherche qui suffit le plus souvent à répondre en un appel : résumé des
 * nœuds trouvés et, pour chaque document trouvé, son contenu entier s'il est
 * court, sinon les sections qui contiennent les mots cherchés (avec leur
 * position, pour lire la suite). Le tout dans la limite de `maxChars` ; les
 * documents hors budget restent signalés par un extrait. Si aucun nœud ne
 * contient tous les mots, ceux qui en contiennent au moins un sont renvoyés
 * (`allTerms: false`), plutôt qu'une liste vide qui obligerait à relancer.
 * Une réponse coupée l'annonce, avec le budget qu'il aurait fallu
 * (`maxCharsNeeded`).
 */
export function search(
  ctx: ReadContext,
  input: { query: string; limit: number; maxChars: number },
  /** Tri ou filtre des nœuds trouvés, avant la limite (contexte automatique). */
  select: (hits: SearchHit[]) => SearchHit[] = (hits) => hits,
) {
  const service = new SearchService(() => ctx);
  let hits = service.search(input.query);
  const allTerms = hits.length > 0;
  if (!allTerms) hits = service.search(input.query, { matchAll: false });
  hits = select(hits).slice(0, input.limit);
  const outline = loadOutline(ctx);
  const summaryOf = ctx.db.prepare('SELECT summary FROM node WHERE id = ?');
  const documents = new DocumentService(() => ctx);
  const patterns = termPatterns(input.query);

  const found: FoundDocument[] = [];
  const snippets: {
    nodeId: string;
    documentId: string;
    document: string | null;
    snippet: string;
  }[] = [];
  let used = 0;
  let needed = 0;
  for (const hit of hits) {
    for (const match of hit.matches) {
      // Les correspondances dans le titre ou le résumé sont couvertes par la
      // colonne summary des nœuds.
      if (!match.documentId) continue;
      const doc = documents.get(match.documentId);
      const remaining = input.maxChars - used;
      const base = {
        id: doc.id,
        title: doc.title,
        path: pathOf(outline, doc.nodeId),
        contentType: doc.contentType,
        language: doc.language,
        totalChars: doc.body.length,
      };
      if (doc.body.length <= SHORT_DOCUMENT_CHARS) {
        needed += doc.body.length;
        if (doc.body.length <= remaining) {
          used += doc.body.length;
          found.push({ ...base, body: doc.body, sections: [] });
          continue;
        }
      } else if (input.maxChars > 0) {
        const { sections, chars } = matchingSections(
          sectionsOf(doc),
          patterns,
          remaining,
        );
        needed += chars;
        if (sections.length > 0) {
          used += sections.reduce((sum, part) => sum + part.content.length, 0);
          found.push({ ...base, body: null, sections });
          continue;
        }
      }
      snippets.push({
        nodeId: hit.nodeId,
        documentId: match.documentId,
        document: match.documentTitle,
        snippet: markSnippet(match.snippet),
      });
    }
  }

  return {
    result: {
      query: input.query,
      ...(allTerms ? {} : { allTerms: false }),
      nodeCount: hits.length,
      // Le chemin se termine par le titre : pas de colonne title en double.
      nodes: hits.map((hit) => ({
        id: hit.nodeId,
        path: pathOf(outline, hit.nodeId),
        type: hit.nodeType,
        summary:
          (summaryOf.get(hit.nodeId) as { summary: string | null } | undefined)
            ?.summary ?? null,
      })),
      // Documents trouvés mais hors budget : à lire avec nodal_read_document.
      ...(snippets.length > 0 ? { otherMatches: snippets } : {}),
      // 0 : extraits seuls, demandés.
      ...(input.maxChars > 0 && needed > input.maxChars
        ? { maxCharsNeeded: needed }
        : {}),
    },
    documents: found,
  };
}

/**
 * Détail d'un nœud, avec le contenu de ses documents courts (moins de
 * SHORT_DOCUMENT_CHARS caractères, GET_NODE_INLINE_CHARS au total) : le plus
 * souvent, plus besoin d'appeler nodal_read_document ensuite.
 */
export function getNode(ctx: ReadContext, id: string) {
  const detail = new NodeService(() => ctx).get(id);
  const outline = loadOutline(ctx);
  const documents = new DocumentService(() => ctx);
  const path = pathOf(outline, detail.id);
  const bodies = detail.documents.map((doc) => documents.get(doc.id));
  const inline: FoundDocument[] = [];
  let used = 0;
  for (const doc of bodies) {
    if (
      doc.body.length <= SHORT_DOCUMENT_CHARS &&
      used + doc.body.length <= GET_NODE_INLINE_CHARS
    ) {
      used += doc.body.length;
      inline.push({
        id: doc.id,
        title: doc.title,
        path,
        contentType: doc.contentType,
        language: doc.language,
        totalChars: doc.body.length,
        body: doc.body,
        sections: [],
      });
    }
  }
  return {
    result: {
      node: {
        id: detail.id,
        title: detail.title,
        type: detail.nodeType,
        path,
        parentId: detail.parentId,
        summary: detail.summary,
        tags: detail.tags.map((tag) => tag.name).join(', '),
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        createdBy: origin(detail.createdByAssistant),
        // Fichiers du code ancrés : absent s'il n'y en a pas.
        ...anchorsOf(ctx, detail.id),
      },
      // chars : taille du document ; les documents courts suivent en entier.
      documents: bodies.map((doc) => ({
        id: doc.id,
        title: doc.title,
        contentType: doc.contentType,
        language: doc.language,
        chars: doc.body.length,
        updatedAt: doc.updatedAt,
      })),
      children: (outline.children.get(detail.id) ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        type: row.node_type,
        children: childCount(outline, row.id),
        documents: row.document_count,
      })),
      relations: relationRows(ctx, detail.id),
      attachments: detail.attachments.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      })),
      // Rétroliens : absent s'il n'y en a pas (aucun token pour rien).
      ...mentionedIn(ctx, detail.id),
    },
    documents: inline,
  };
}

/**
 * Relations d'un nœud ; confiance et sources seulement si l'une en a. Une
 * citation introuvable est marquée « ? ».
 */
function relationRows(ctx: ReadContext, nodeId: string) {
  const relations = new EdgeService(() => ctx).listForNode(nodeId);
  const graded = relations.some((rel) => rel.confidence);
  const sourced = relations.some((rel) => rel.evidence);
  return relations.map((rel) => ({
    direction: rel.direction === 'outgoing' ? 'out' : 'in',
    relation: rel.relationTypeName,
    otherId: rel.otherNodeId,
    other: rel.otherNodeTitle,
    label: rel.label,
    by: origin(rel.createdByAssistant),
    ...(graded ? { confidence: rel.confidence ?? null } : {}),
    ...(sourced
      ? {
          sources: (rel.evidence ?? [])
            .map(
              (item) => `${item.source}${item.verified === false ? ' ?' : ''}`,
            )
            .join(' ; '),
        }
      : {}),
  }));
}

function anchorsOf(ctx: ReadContext, nodeId: string) {
  const patterns = listAnchors(ctx, nodeId);
  return patterns.length > 0 ? { anchors: patterns.join(', ') } : {};
}

/** Lignes par vérification renvoyées par défaut par nodal_health. */
export const HEALTH_MCP_LIMIT = 10;

/**
 * Santé de la base pour un assistant : compteurs, une seule table de
 * problèmes (colonne check) et les sujets à documenter. `stale` : résultat
 * de la vérification des fichiers ancrés (`null` : aucun nœud ancré).
 */
export function health(
  ctx: ReadContext,
  input: { limit?: number },
  stale: readonly StaleNode[] | null = null,
) {
  const report = healthReport(ctx, input.limit ?? HEALTH_MCP_LIMIT, stale);
  const outline = loadOutline(ctx);
  return {
    counts: Object.fromEntries(
      report.checks.map((check) => [check.id, check.count]),
    ),
    issues: report.checks.flatMap((check) =>
      check.issues.map((item) => ({
        check: item.check,
        id: item.nodeId,
        path: pathOf(outline, item.nodeId),
        detail:
          item.documentTitle && item.detail
            ? `${item.documentTitle} : ${item.detail}`
            : (item.documentTitle ?? item.detail ?? ''),
      })),
    ),
    gaps: report.gaps.map((gap) => ({
      query: gap.query,
      count: gap.count,
      lastAt: gap.lastAt.slice(0, 10),
    })),
  };
}

/** Documents qui mentionnent le nœud par un lien [[...]] : nœud et document. */
function mentionedIn(ctx: ReadContext, nodeId: string) {
  const mentions = listBacklinks(ctx, nodeId);
  if (mentions.length === 0) return {};
  return {
    mentionedIn: mentions.map((mention) => ({
      id: mention.nodeId,
      title: mention.nodeTitle,
      document: mention.documentTitle,
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
  for (let level = 1; level <= input.depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (distance.has(neighbor)) continue;
        distance.set(neighbor, level);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  // Les plus proches d'abord (parcours en largeur).
  const total = distance.size;
  const kept = new Map([...distance].slice(0, maxNodes));

  return {
    center: pathOf(outline, input.nodeId),
    nodes: [...kept].map(([id, dist]) => {
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
          kept.has(edge.source_node_id) && kept.has(edge.target_node_id),
      )
      .map((edge) => ({
        sourceId: edge.source_node_id,
        relation: edge.relation,
        targetId: edge.target_node_id,
        label: edge.label,
        by: origin(edge.by_assistant),
      })),
    truncated: total > maxNodes,
    ...(total > maxNodes ? { maxNodesNeeded: total } : {}),
  };
}

/** Lien d'une étape, compact : sens et type (« → dépend de », « ↑ parent »). */
function describeLink(link: PathLink, relationNames: Map<string, string>) {
  if (link.kind !== 'relation') {
    return link.kind === 'parent' ? '↑ parent' : '↓ enfant';
  }
  const name = relationNames.get(link.relationTypeId) ?? '?';
  return `${link.forward ? '→' : '←'} ${name}`;
}

function pathEdges(ctx: ReadContext): PathGraphEdge[] {
  return asRows<PathGraphEdge>(
    ctx.db
      .prepare(
        `SELECT id, source_node_id AS sourceId, target_node_id AS targetId,
           relation_type_id AS relationTypeId
         FROM edge WHERE workspace_id = ? ORDER BY rowid`,
      )
      .all(ctx.workspaceId),
  );
}

const pathNodes = (outline: Outline) =>
  [...outline.byId.values()].map((row) => ({
    id: row.id,
    parentId: row.parent_id,
  }));

/**
 * Plus court chemin entre deux nœuds par les relations et, si demandé, par la
 * hiérarchie : une ligne par nœud, avec le lien qui y mène depuis le
 * précédent.
 */
export function findPath(
  ctx: ReadContext,
  input: {
    fromId: string;
    toId: string;
    maxDepth?: number;
    includeHierarchy?: boolean;
    directed?: boolean;
  },
) {
  const outline = loadOutline(ctx);
  for (const id of [input.fromId, input.toId]) {
    if (!outline.byId.has(id)) throw notFound(`Nœud ${id}`);
  }
  if (input.fromId === input.toId) {
    throw new NodalError(
      'VALIDATION_ERROR',
      'Le départ et l’arrivée sont le même nœud.',
    );
  }
  const edges = pathEdges(ctx);
  const types = listRelationTypes(ctx);
  const relationNames = new Map(types.map((type) => [type.id, type.name]));
  const maxDepth = input.maxDepth ?? PATH_DEFAULT_DEPTH;
  const includeHierarchy = input.includeHierarchy ?? false;
  const directed = input.directed ?? false;
  const find = (depth: number, options = { includeHierarchy, directed }) =>
    findShortestPath(pathNodes(outline), edges, input.fromId, input.toId, {
      ...options,
      maxDepth: depth,
      vagueTypes: new Set(
        types
          .filter((type) => isVagueRelation(type.name))
          .map((type) => type.id),
      ),
    });
  const found = find(maxDepth);
  const ends = {
    from: pathOf(outline, input.fromId),
    to: pathOf(outline, input.toId),
  };
  if (!found) {
    const longer = maxDepth < PATH_MAX_DEPTH ? find(PATH_MAX_DEPTH) : null;
    const reverse =
      directed && !longer
        ? find(PATH_MAX_DEPTH, { includeHierarchy, directed: false })
        : null;
    let hint = '';
    if (longer) hint = ` Il en existe un en ${longer.steps.length - 1} liens.`;
    else if (reverse) hint = ' Il en existe un sans tenir compte du sens.';
    return {
      ...ends,
      found: false,
      note:
        `Aucun chemin en ${maxDepth} liens au plus` +
        (includeHierarchy ? '.' : ' (hiérarchie exclue : includeHierarchy).') +
        hint,
    };
  }
  return {
    ...ends,
    length: found.steps.length - 1,
    // D'autres chemins aussi courts : celui-ci est le plus parlant.
    ...(found.routes > 1 ? { sameLength: found.routes } : {}),
    ...weakestLink(ctx, found.steps),
    steps: found.steps.map((step) => ({
      id: step.nodeId,
      title: outline.byId.get(step.nodeId)!.title,
      via: step.via ? describeLink(step.via, relationNames) : '',
    })),
  };
}

/**
 * Un chemin n'est pas plus sûr que son maillon le plus faible : la confiance
 * de celui-ci, s'il n'est pas certain (sans avis : rien à en dire).
 */
function weakestLink(ctx: ReadContext, steps: readonly PathStep[]) {
  const confidenceOf = ctx.db.prepare(
    'SELECT confidence FROM edge WHERE id = ?',
  );
  const links = steps.flatMap(({ via }) => {
    if (via?.kind !== 'relation') return [];
    const row = confidenceOf.get(via.edgeId) as
      | { confidence: Confidence | null }
      | undefined;
    return row?.confidence ? [row.confidence] : [];
  });
  const weakest = links.toSorted(
    (a, b) => confidenceRank(a) - confidenceRank(b),
  )[0];
  return weakest && weakest !== 'certain' ? { weakest } : {};
}

/** Nœuds listés au plus par nodal_impact. */
export const IMPACT_MAX_ROWS = 100;

/**
 * Nœuds à revoir si un nœud, ou les nœuds ancrés à des fichiers, changent.
 * `relations` : types (en plus de ceux dont le sens est connu) où la source
 * dépend de la cible.
 */
export function impact(
  ctx: ReadContext,
  input: {
    nodeId?: string;
    paths?: string[];
    depth?: number;
    relations?: string[];
  },
  roots: string[],
) {
  if (Boolean(input.nodeId) === Boolean(input.paths?.length)) {
    throw new NodalError('VALIDATION_ERROR', 'Donnez soit nodeId, soit paths.');
  }
  const outline = loadOutline(ctx);
  if (input.nodeId && !outline.byId.has(input.nodeId)) throw notFound('Nœud');
  const relative = (input.paths ?? []).flatMap(
    (raw) => toRootRelative(raw, roots, PATHS_CASE_INSENSITIVE)?.path || [],
  );
  const seeds = input.nodeId
    ? [input.nodeId]
    : nodesForPaths(ctx, relative).map(({ node }) => node.nodeId);

  const types = listRelationTypes(ctx);
  const extra = new Set((input.relations ?? []).map((name) => foldText(name)));
  for (const name of input.relations ?? []) {
    if (!types.some((type) => foldText(type.name) === foldText(name))) {
      throw new NodalError(
        'VALIDATION_ERROR',
        `Type de relation « ${name} » inconnu (${types.map((type) => type.name).join(', ')}).`,
      );
    }
  }
  const directions = new Map(
    types.map((type) => [
      type.id,
      extra.has(foldText(type.name)) ? 'source' : impactDirection(type.name),
    ]),
  );
  const names = new Map(types.map((type) => [type.id, type.name]));
  const edges = pathEdges(ctx);
  const hits = impactOf(
    pathNodes(outline),
    edges,
    seeds,
    (typeId) => directions.get(typeId) ?? 'none',
    input.depth ?? IMPACT_DEFAULT_DEPTH,
  );
  const shown = hits.slice(0, IMPACT_MAX_ROWS);
  // Relations écartées autour des nœuds vus : leur sens n'est pas connu.
  const seen = new Set([...seeds, ...hits.map((hit) => hit.nodeId)]);
  const ignored = new Set(
    edges
      .filter(
        (edge) =>
          directions.get(edge.relationTypeId) === 'none' &&
          (seen.has(edge.sourceId) || seen.has(edge.targetId)),
      )
      .map((edge) => names.get(edge.relationTypeId)!),
  );
  return {
    of: seeds.map((id) => ({ id, path: pathOf(outline, id) })),
    affectedCount: hits.length,
    affected: shown.map((hit) => ({
      id: hit.nodeId,
      path: pathOf(outline, hit.nodeId),
      depth: hit.depth,
      via:
        directions.get(hit.relationTypeId) === 'source'
          ? `${names.get(hit.relationTypeId)} ${outline.byId.get(hit.fromId)!.title}`
          : `${outline.byId.get(hit.fromId)!.title} ${names.get(hit.relationTypeId)}`,
    })),
    ...(ignored.size > 0 ? { relationsIgnored: [...ignored].join(', ') } : {}),
    ...(seeds.length === 0 ? { note: 'Aucun nœud ancré à ces fichiers.' } : {}),
  };
}

/** Lignes par rubrique de nodal_analyze. */
export const ANALYZE_DEFAULT_LIMIT = 5;

/** Ce que la forme du graphe suggère de regarder. */
export function analyze(ctx: ReadContext, input: { limit?: number }) {
  const graph = readAnalysisGraph(ctx);
  const limit = input.limit ?? ANALYZE_DEFAULT_LIMIT;
  const title = new Map(graph.nodes.map((node) => [node.id, node.title]));
  const edgeText = (edge: (typeof graph.edges)[number]) =>
    `${title.get(edge.sourceId)} → ${edge.relation} → ${title.get(edge.targetId)}`;
  return {
    questions: suggestedQuestions(graph, limit).map((item) => ({
      question: item.question,
      why: item.why,
    })),
    connections: connections(graph)
      .slice(0, limit)
      .map(({ edge, reasons }) => ({
        relation: edgeText(edge),
        why: reasons.join(' ; '),
      })),
    bridges: bridges(graph)
      .slice(0, limit)
      .map(({ nodeId, score }) => ({
        id: nodeId,
        title: title.get(nodeId)!,
        share: Math.round(score * 100) / 100,
      })),
    redundant: redundantRelations(graph)
      .slice(0, limit)
      .map(({ edge, reason, through }) => ({
        relation: edgeText(edge),
        reason,
        through: through.map((id) => title.get(id)).join(' → '),
      })),
    cycles: dependencyCycles(graph)
      .slice(0, limit)
      .map((cycle) =>
        [...cycle, cycle[0]!].map((id) => title.get(id)).join(' → '),
      ),
  };
}

// --- Mémoire de travail ---------------------------------------------------

/** Leçons jointes au plus à une réponse. */
export const LESSONS_LIMIT = 3;

/** Ligne compacte d'une leçon ; `stale` seulement s'il y en a. */
export function lessonRows(lessons: readonly Lesson[]) {
  const anyStale = lessons.some((lesson) => lesson.stale);
  return lessons.map((lesson) => ({
    outcome: lesson.outcome,
    question: lesson.question,
    note: lesson.note,
    nodes: lesson.nodes.map((node) => node.title).join(', '),
    date: lesson.createdAt.slice(0, 10),
    ...(anyStale ? { stale: lesson.stale } : {}),
  }));
}

/** Nombre de mots de la requête présents dans la leçon. */
export function lessonOverlap(
  lesson: Pick<Lesson, 'key' | 'note'>,
  patterns: readonly RegExp[],
): number {
  const text = `${lesson.key} ${normalize(lesson.note ?? '')}`;
  return patterns.filter((pattern) => pattern.test(text)).length;
}

/**
 * Leçons à rappeler avec des nœuds : leurs impasses et corrections, les plus
 * proches de la requête d'abord, et le bilan des nœuds déjà éprouvés. Vide
 * (aucun champ) s'il n'y a rien à en dire.
 */
export function lessonsOf(
  ctx: ReadContext,
  roots: readonly string[],
  nodeIds: readonly string[],
  query = '',
) {
  const wanted = new Set(nodeIds);
  const lessons = listLessons(ctx, roots, (lesson) =>
    lesson.nodes.some((node) => wanted.has(node.id)),
  );
  if (lessons.length === 0) return {};
  const patterns = termPatterns(query);
  const warnings = currentLessons(lessons)
    .filter((lesson) => lesson.outcome !== 'useful')
    .map((lesson) => ({ lesson, overlap: lessonOverlap(lesson, patterns) }))
    .toSorted((a, b) => b.overlap - a.overlap)
    .slice(0, LESSONS_LIMIT)
    .map(({ lesson }) => lesson);
  const now = new Date(ctx.now());
  const memory = nodeIds.flatMap((id) => {
    const verdict = nodeVerdict(
      lessons.filter((lesson) => lesson.nodes.some((node) => node.id === id)),
      now,
    );
    // Utile une seule fois : pas encore une indication.
    return verdict &&
      (verdict.status === 'trusted' || verdict.status === 'contested')
      ? [
          {
            id,
            status: verdict.status,
            useful: verdict.useful,
            negative: verdict.negative,
            // Positif : les avis récents penchent vers « utile ».
            score: Math.round(verdict.score * 100) / 100,
          },
        ]
      : [];
  });
  return {
    ...(memory.length > 0 ? { memory } : {}),
    ...(warnings.length > 0 ? { lessons: lessonRows(warnings) } : {}),
  };
}

/** Leçons de l'espace, filtrées par mots et par issue. */
export function lessons(
  ctx: ReadContext,
  input: { query?: string; outcome?: LessonOutcome; limit?: number },
  roots: readonly string[],
) {
  const patterns = termPatterns(input.query ?? '');
  const found = currentLessons(
    listLessons(
      ctx,
      roots,
      (lesson) =>
        (!input.outcome || lesson.outcome === input.outcome) &&
        (patterns.length === 0 || lessonOverlap(lesson, patterns) > 0),
    ),
  ).toSorted((a, b) => lessonOverlap(b, patterns) - lessonOverlap(a, patterns));
  const limit = input.limit ?? 20;
  return {
    count: found.length,
    lessons: lessonRows(found.slice(0, limit)),
  };
}

// --- Fichiers du code ----------------------------------------------------

/**
 * De quoi vérifier, après l'appel et hors connexion, si des nœuds sont
 * possiblement obsolètes : dossiers de code et nœuds ancrés concernés.
 */
export interface AnchorCheck {
  roots: string[];
  nodes: AnchoredNode[];
}

/**
 * Dossiers de code vus par le serveur : ceux de l'espace, ou à défaut le
 * dossier du projet depuis lequel le client MCP a lancé le serveur (dépôt
 * git), sans rien écrire dans la base.
 */
export function codeRootsFor(
  ctx: ReadContext,
  workspaceFile: string,
  projectRoot: string | null = null,
): string[] {
  const declared = resolveCodeRoots(readCodeRoots(ctx), workspaceFile);
  return declared.length > 0 || !projectRoot ? declared : [projectRoot];
}

export function anchorCheck(
  ctx: ReadContext,
  roots: string[],
  nodeIds?: readonly string[],
): AnchorCheck {
  return {
    roots,
    nodes:
      roots.length > 0
        ? withSnapshots(ctx, listAnchoredNodes(ctx, nodeIds))
        : [],
  };
}

/** Fichiers modifiés, en une chaîne : les trois plus récents, puis le reste compté. */
export function changedFilesText(stale: StaleNode): string {
  const shown = stale.files.slice(0, 3).map((file) => {
    if (file.deleted) return `${file.path} (supprimé)`;
    return file.added ? `${file.path} (nouveau)` : file.path;
  });
  const more = stale.fileCount - shown.length;
  return more > 0 ? `${shown.join(', ')} (+${more})` : shown.join(', ');
}

/** Ligne compacte d'un nœud possiblement obsolète. */
export const staleRow = (stale: StaleNode) => ({
  id: stale.nodeId,
  since: stale.since.slice(0, 10),
  changed: changedFilesText(stale),
});

/** Contenu de documents renvoyé par défaut par nodal_for_files. */
export const DEFAULT_FOR_FILES_CHARS = 6_000;

/**
 * Nœuds ancrés à des fichiers du code (chemins absolus, ou relatifs à un
 * dossier de code), au format de nodal_search : chemin, type et résumé de
 * chaque nœud, fichiers concernés, puis ses documents courts dans la limite
 * de `maxChars` ; les autres documents sont cités (otherDocuments).
 */
export function forFiles(
  ctx: ReadContext,
  input: { paths: string[]; maxChars: number },
  roots: string[],
) {
  if (roots.length === 0) {
    return {
      result: {
        nodeCount: 0,
        note: "Aucun dossier de code n'est déclaré dans Nodal (paramètres de l'espace) : aucun fichier n'est ancré.",
      },
      documents: [] as FoundDocument[],
      check: { roots, nodes: [] } as AnchorCheck,
    };
  }
  const relative: string[] = [];
  const unknown: string[] = [];
  for (const raw of input.paths) {
    const found = toRootRelative(raw, roots, PATHS_CASE_INSENSITIVE);
    if (found?.path) relative.push(found.path);
    else unknown.push(raw);
  }
  const matches = nodesForPaths(ctx, relative);
  const covered = new Set(matches.flatMap((match) => match.paths));
  const outline = loadOutline(ctx);
  const nodeInfo = ctx.db.prepare(
    'SELECT node_type, summary FROM node WHERE id = ?',
  );
  const documentIds = ctx.db.prepare(
    'SELECT id FROM document WHERE node_id = ? ORDER BY sort_order, rowid',
  );
  const documents = new DocumentService(() => ctx);
  const found: FoundDocument[] = [];
  const others: { nodeId: string; id: string; title: string; chars: number }[] =
    [];
  let used = 0;
  let needed = 0;
  for (const { node } of matches) {
    const path = pathOf(outline, node.nodeId);
    for (const { id } of documentIds.all(node.nodeId) as { id: string }[]) {
      const doc = documents.get(id);
      const size = doc.body.length;
      if (size <= SHORT_DOCUMENT_CHARS) needed += size;
      if (size <= SHORT_DOCUMENT_CHARS && used + size <= input.maxChars) {
        used += size;
        found.push({
          id: doc.id,
          title: doc.title,
          path,
          contentType: doc.contentType,
          language: doc.language,
          totalChars: size,
          body: doc.body,
          sections: [],
        });
      } else {
        others.push({ nodeId: node.nodeId, id, title: doc.title, chars: size });
      }
    }
  }
  const notAnchored = [
    ...relative.filter((file) => !covered.has(file)),
    ...unknown,
  ];
  return {
    result: {
      nodeCount: matches.length,
      nodes: matches.map(({ node, paths }) => {
        const info = nodeInfo.get(node.nodeId) as {
          node_type: NodeType;
          summary: string | null;
        };
        return {
          id: node.nodeId,
          path: pathOf(outline, node.nodeId),
          type: info.node_type,
          summary: info.summary,
          files: paths.join(', '),
        };
      }),
      ...(others.length > 0 ? { otherDocuments: others } : {}),
      ...(input.maxChars > 0 && needed > input.maxChars
        ? { maxCharsNeeded: needed }
        : {}),
      // Fichiers sans nœud : à documenter, ou à ancrer à un nœud existant.
      ...(notAnchored.length > 0
        ? { notAnchored: notAnchored.join(', ') }
        : {}),
    },
    documents: found,
    check: {
      roots,
      nodes: withSnapshots(
        ctx,
        matches.map(({ node }) => node),
      ),
    },
  };
}
