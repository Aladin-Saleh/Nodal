/**
 * Santé de la base : ce qui mérite l'attention de l'utilisateur ou d'un
 * assistant (résumés manquants, documents vides, nœuds isolés, liens cassés,
 * doublons probables, ajouts de l'IA à relire), et sujets à documenter
 * (recherches d'un assistant restées sans résultat).
 *
 * Chaque vérification est une entrée de `HEALTH_CHECKS` : une nouvelle
 * vérification s'ajoute à la liste sans toucher au reste. Seule la
 * documentation obsolète (fichiers ancrés modifiés) est à part : elle lit le
 * disque de façon asynchrone et son résultat est passé à `healthReport`.
 */
import type {
  HealthCheckId,
  HealthIssue,
  HealthReport,
  SearchGap,
} from '../../shared/model';
import type { StaleNode } from '../../shared/code-anchors';
import {
  dependencyCycles,
  redundantRelations,
  suggestedQuestions,
} from '../../shared/graph-analysis';
import { duplicatePairs, pairKey } from '../../shared/duplicates';
import { foldText } from '../../shared/text';
import { parseWikiLinks, resolveTarget } from '../../shared/wiki-links';
import { readAnalysisGraph } from './analysis-service';
import { pendingAssistantNodeIds } from './assistant-origin';
import { notFound, type ServiceContext } from './context';
import { workspaceLinkResolver } from './link-service';
import { asRows } from './rows';

/** Lignes renvoyées au plus par vérification (les compteurs restent exacts). */
export const HEALTH_DEFAULT_LIMIT = 50;
/** Lacunes gardées au plus : les plus anciennes sont oubliées au-delà. */
export const SEARCH_GAP_LIMIT = 500;

export interface HealthCheck {
  id: HealthCheckId;
  label: string;
  run(ctx: ServiceContext): HealthIssue[];
}

interface NodeRow {
  id: string;
  title: string;
  parent_id: string | null;
}

function allNodes(ctx: ServiceContext): NodeRow[] {
  return asRows<NodeRow>(
    ctx.db
      .prepare(
        'SELECT id, title, parent_id FROM node WHERE workspace_id = ? ORDER BY rowid',
      )
      .all(ctx.workspaceId),
  );
}

const issue = (
  check: HealthCheckId,
  node: { id: string; title: string },
  extra: Partial<HealthIssue> = {},
): HealthIssue => ({ check, nodeId: node.id, title: node.title, ...extra });

/** Paires écartées par l'utilisateur (« Pas un doublon »). */
function ignoredPairs(ctx: ServiceContext): Set<string> {
  return new Set(
    asRows<{ a: string; b: string }>(
      ctx.db
        .prepare(
          'SELECT first_node_id AS a, second_node_id AS b FROM duplicate_ignored',
        )
        .all(),
    ).map(({ a, b }) => pairKey(a, b)),
  );
}

/** « Pas un doublon » : la paire n'est plus signalée. */
export function ignoreDuplicate(
  ctx: ServiceContext,
  a: string,
  b: string,
): void {
  const exists = ctx.db.prepare(
    'SELECT 1 FROM node WHERE id = ? AND workspace_id = ?',
  );
  if (a === b || ![a, b].every((id) => exists.get(id, ctx.workspaceId)))
    throw notFound('Nœud');
  const [first, second] = a < b ? [a, b] : [b, a];
  ctx.db
    .prepare('INSERT OR IGNORE INTO duplicate_ignored VALUES (?, ?, ?)')
    .run(first, second, ctx.now());
}

export const HEALTH_CHECKS: HealthCheck[] = [
  {
    id: 'noSummary',
    label: 'Nœuds sans résumé',
    run: (ctx) =>
      asRows<NodeRow>(
        ctx.db
          .prepare(
            `SELECT id, title, parent_id FROM node
             WHERE workspace_id = ? AND (summary IS NULL OR trim(summary) = '')
             ORDER BY rowid`,
          )
          .all(ctx.workspaceId),
      ).map((node) => issue('noSummary', node)),
  },
  {
    id: 'emptyDocument',
    label: 'Documents vides',
    run: (ctx) =>
      asRows<{
        id: string;
        title: string;
        document_id: string;
        document_title: string;
      }>(
        ctx.db
          .prepare(
            `SELECT n.id, n.title, d.id AS document_id, d.title AS document_title
             FROM document d JOIN node n ON n.id = d.node_id
             WHERE n.workspace_id = ? AND trim(d.body) = ''
             ORDER BY n.rowid, d.sort_order`,
          )
          .all(ctx.workspaceId),
      ).map((row) =>
        issue('emptyDocument', row, {
          documentId: row.document_id,
          documentTitle: row.document_title,
        }),
      ),
  },
  {
    id: 'orphan',
    label: 'Nœuds isolés (ni relation ni enfant)',
    run: (ctx) =>
      asRows<NodeRow>(
        ctx.db
          .prepare(
            `SELECT n.id, n.title, n.parent_id FROM node n
             WHERE n.workspace_id = ? AND n.parent_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM node c WHERE c.parent_id = n.id)
               AND NOT EXISTS (SELECT 1 FROM edge e
                 WHERE e.source_node_id = n.id OR e.target_node_id = n.id)
             ORDER BY n.rowid`,
          )
          .all(ctx.workspaceId),
      ).map((node) => issue('orphan', node)),
  },
  {
    id: 'brokenLink',
    label: 'Liens [[…]] cassés',
    run: (ctx) => {
      const resolver = workspaceLinkResolver(ctx);
      const docs = asRows<{
        id: string;
        title: string;
        document_id: string;
        document_title: string;
        body: string;
      }>(
        ctx.db
          .prepare(
            `SELECT n.id, n.title, d.id AS document_id, d.title AS document_title, d.body
             FROM document d JOIN node n ON n.id = d.node_id
             WHERE n.workspace_id = ? AND d.content_type = 'markdown'
               AND instr(d.body, '[[') > 0
             ORDER BY n.rowid, d.sort_order`,
          )
          .all(ctx.workspaceId),
      );
      return docs.flatMap((doc) =>
        parseWikiLinks(doc.body)
          .filter((link) => !resolveTarget(link.target, resolver))
          .map((link) =>
            issue('brokenLink', doc, {
              documentId: doc.document_id,
              documentTitle: doc.document_title,
              detail:
                link.target.kind === 'title'
                  ? link.target.title
                  : (link.text ?? 'nœud supprimé'),
            }),
          ),
      );
    },
  },
  {
    id: 'duplicate',
    label: 'Doublons probables',
    run: (ctx) => {
      const nodes = allNodes(ctx);
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const ignored = ignoredPairs(ctx);
      return duplicatePairs(
        nodes.map(({ id, title, parent_id }) => ({
          id,
          title,
          parentId: parent_id,
        })),
      )
        .filter(([a, b]) => !ignored.has(pairKey(a, b)))
        .map(([a, b]) => {
          const other = byId.get(b)!;
          return issue('duplicate', byId.get(a)!, {
            otherNodeId: other.id,
            detail: other.title,
          });
        });
    },
  },
  {
    id: 'redundantRelation',
    label: 'Relations superflues',
    run: (ctx) => {
      const graph = readAnalysisGraph(ctx);
      const byId = new Map(graph.nodes.map((node) => [node.id, node]));
      return redundantRelations(graph).map(({ edge, reason, through }) => {
        const source = byId.get(edge.sourceId)!;
        const target = byId.get(edge.targetId)!;
        const why = {
          duplicate: 'une autre relation les lie déjà',
          hierarchy: 'ils sont parent et enfant',
          implied: `déjà impliqué par ${through.map((id) => byId.get(id)!.title).join(' → ')}`,
        }[reason];
        return issue('redundantRelation', source, {
          otherNodeId: target.id,
          detail: `${edge.relation} ${target.title} : ${why}`,
        });
      });
    },
  },
  {
    id: 'dependencyCycle',
    label: 'Cycles de dépendance',
    run: (ctx) => {
      const graph = readAnalysisGraph(ctx);
      const byId = new Map(graph.nodes.map((node) => [node.id, node]));
      return dependencyCycles(graph).map((cycle) => {
        const titles = [...cycle, cycle[0]!].map((id) => byId.get(id)!.title);
        return issue('dependencyCycle', byId.get(cycle[0]!)!, {
          otherNodeId: cycle[1]!,
          detail: titles.join(' → '),
        });
      });
    },
  },
  {
    id: 'assistantPending',
    label: 'Ajouts de l’IA à relire',
    run: (ctx) => {
      const pending = pendingAssistantNodeIds(ctx);
      return allNodes(ctx)
        .filter((node) => pending.has(node.id))
        .map((node) => issue('assistantPending', node));
    },
  },
];

export const STALE_CHECK_LABEL = 'Documentation possiblement obsolète';

/**
 * Lignes « documentation possiblement obsolète » : la vérification lit le
 * disque et git (asynchrone, hors connexion), son résultat est passé ici.
 */
function staleIssues(
  ctx: ServiceContext,
  stale: readonly StaleNode[],
): HealthIssue[] {
  const titleOf = ctx.db.prepare(
    'SELECT title FROM node WHERE id = ? AND workspace_id = ?',
  );
  return stale.flatMap((node) => {
    const row = titleOf.get(node.nodeId, ctx.workspaceId) as
      | { title: string }
      | undefined;
    if (!row) return [];
    const shown = node.files.slice(0, 3).map((file) => file.path);
    const more = node.fileCount - shown.length;
    return [
      issue(
        'stale',
        { id: node.nodeId, title: row.title },
        {
          detail:
            more > 0 ? `${shown.join(', ')} (+${more})` : shown.join(', '),
        },
      ),
    ];
  });
}

/**
 * Rapport complet : compteurs exacts, listes plafonnées à `limit`. `stale` :
 * nœuds ancrés possiblement obsolètes ; `null` (aucun nœud ancré) omet la
 * vérification.
 */
export function healthReport(
  ctx: ServiceContext,
  limit = HEALTH_DEFAULT_LIMIT,
  stale: readonly StaleNode[] | null = null,
): HealthReport {
  const checks = HEALTH_CHECKS.map((check) => ({
    id: check.id,
    label: check.label,
    issues: check.run(ctx),
  }));
  if (stale) {
    checks.push({
      id: 'stale',
      label: STALE_CHECK_LABEL,
      issues: staleIssues(ctx, stale),
    });
  }
  return {
    checks: checks.map((check) => ({
      ...check,
      count: check.issues.length,
      issues: check.issues.slice(0, limit),
    })),
    questions: suggestedQuestions(readAnalysisGraph(ctx)),
    gaps: listSearchGaps(ctx, 'open', limit),
  };
}

// --- Sujets à documenter (recherches sans résultat) -------------------------

/** Requête normalisée : regroupe « Kafka » et « kafka ». */
export const gapKey = (query: string) =>
  foldText(query).replace(/\s+/gu, ' ').trim();

/** Note une recherche restée sans résultat (requête, date, compteur). */
export function recordSearchGap(ctx: ServiceContext, query: string): void {
  const key = gapKey(query);
  if (!key) return;
  const now = ctx.now();
  ctx.db
    .prepare(
      `INSERT INTO search_gap (workspace_id, query_key, query, count, first_at, last_at, status)
       VALUES (?, ?, ?, 1, ?, ?, 'open')
       ON CONFLICT (workspace_id, query_key) DO UPDATE SET
         count = count + 1, last_at = excluded.last_at, query = excluded.query`,
    )
    .run(ctx.workspaceId, key, query.trim(), now, now);
  // Taille bornée : les lacunes les plus anciennes sont oubliées.
  ctx.db
    .prepare(
      `DELETE FROM search_gap WHERE workspace_id = :ws AND query_key IN (
         SELECT query_key FROM search_gap WHERE workspace_id = :ws
         ORDER BY last_at DESC LIMIT -1 OFFSET :keep)`,
    )
    .run({ ws: ctx.workspaceId, keep: SEARCH_GAP_LIMIT });
}

export function listSearchGaps(
  ctx: ServiceContext,
  status: SearchGap['status'],
  limit: number,
): SearchGap[] {
  return asRows<{
    query_key: string;
    query: string;
    count: number;
    first_at: string;
    last_at: string;
    status: SearchGap['status'];
  }>(
    ctx.db
      .prepare(
        `SELECT query_key, query, count, first_at, last_at, status FROM search_gap
         WHERE workspace_id = ? AND status = ?
         ORDER BY count DESC, last_at DESC LIMIT ?`,
      )
      .all(ctx.workspaceId, status, limit),
  ).map((row) => ({
    key: row.query_key,
    query: row.query,
    count: row.count,
    firstAt: row.first_at,
    lastAt: row.last_at,
    status: row.status,
  }));
}

export function setSearchGapStatus(
  ctx: ServiceContext,
  key: string,
  status: SearchGap['status'],
): void {
  ctx.db
    .prepare(
      'UPDATE search_gap SET status = ? WHERE workspace_id = ? AND query_key = ?',
    )
    .run(status, ctx.workspaceId, key);
}
