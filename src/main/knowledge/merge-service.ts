/**
 * Fusion de deux nœuds : l'un reçoit tout ce que l'autre porte, qui disparaît.
 * Rien n'est perdu ni écrasé : ce que le nœud gardé a déjà reste tel quel.
 */
import { ANCHORS_MAX_PER_NODE } from '../../shared/code-anchors';
import { NodalError } from '../../shared/errors';
import type { MergePreview, MergeSide } from '../../shared/model';
import {
  formatNodeLink,
  resolveTarget,
  rewriteWikiLinks,
} from '../../shared/wiki-links';
import { inTransaction } from '../database/transaction';
import {
  listAnchoredNodes,
  listAnchors,
  saveSnapshot,
  setAnchors,
  withSnapshots,
} from './anchor-service';
import { pendingAssistantNodeIds } from './assistant-origin';
import { notFound, type ServiceContext } from './context';
import { syncNodeLinks, workspaceLinkResolver } from './link-service';
import { NodeService } from './node-service';
import { asRow, asRows } from './rows';

interface MergeRow {
  id: string;
  title: string;
  summary: string | null;
  color: string | null;
  parent_id: string | null;
  sort_order: number;
  updated_at: string;
}

function nodeRow(ctx: ServiceContext, id: string): MergeRow {
  const row = asRow<MergeRow>(
    ctx.db
      .prepare(
        `SELECT id, title, summary, color, parent_id, sort_order, updated_at
         FROM node WHERE id = ? AND workspace_id = ?`,
      )
      .get(id, ctx.workspaceId),
  );
  if (!row) throw notFound('Nœud');
  return row;
}

function sideOf(ctx: ServiceContext, id: string): MergeSide {
  const row = nodeRow(ctx, id);
  const count = (sql: string) =>
    (ctx.db.prepare(sql).get({ id }) as { n: number }).n;
  return {
    id,
    title: row.title,
    parentTitle: row.parent_id ? nodeRow(ctx, row.parent_id).title : null,
    hasSummary: Boolean(row.summary?.trim()),
    documents: count('SELECT count(*) AS n FROM document WHERE node_id = :id'),
    chars: count(
      'SELECT coalesce(sum(length(body)), 0) AS n FROM document WHERE node_id = :id',
    ),
    relations: count(
      'SELECT count(*) AS n FROM edge WHERE source_node_id = :id OR target_node_id = :id',
    ),
    children: count('SELECT count(*) AS n FROM node WHERE parent_id = :id'),
    attachments: count(
      'SELECT count(*) AS n FROM attachment WHERE node_id = :id',
    ),
  };
}

/**
 * Les deux nœuds, et celui à garder : le plus fourni (pas le titre le plus
 * court), puis validé plutôt qu'ajouté par l'IA, enfin le plus ancien.
 */
export function mergePreview(
  ctx: ServiceContext,
  firstId: string,
  secondId: string,
): MergePreview {
  if (firstId === secondId) {
    throw new NodalError(
      'VALIDATION_ERROR',
      'Un nœud ne peut pas être fusionné avec lui-même.',
    );
  }
  const first = sideOf(ctx, firstId);
  const second = sideOf(ctx, secondId);
  const pending = pendingAssistantNodeIds(ctx);
  const richness = (side: MergeSide) =>
    (side.hasSummary ? 1 : 0) +
    side.documents * 2 +
    Math.floor(side.chars / 1000) +
    side.relations +
    side.children +
    side.attachments;
  const [a, b] = [first, second];
  const better =
    richness(b) - richness(a) ||
    Number(pending.has(a.id)) - Number(pending.has(b.id));
  const oldest = ctx.db
    .prepare(
      'SELECT id FROM node WHERE id IN (?, ?) ORDER BY created_at, rowid LIMIT 1',
    )
    .get(firstId, secondId) as { id: string };
  let keepId = oldest.id;
  if (better !== 0) keepId = better < 0 ? a.id : b.id;
  return { first, second, keepId };
}

/** Liens [[…]] de tout l'espace vers `drop`, redirigés vers `keep`. */
function redirectLinks(
  ctx: ServiceContext,
  keep: MergeRow,
  drop: MergeRow,
): { links: number; nodeIds: Set<string> } {
  const resolver = workspaceLinkResolver(ctx);
  const update = ctx.db.prepare('UPDATE document SET body = ? WHERE id = ?');
  const nodeIds = new Set<string>();
  let links = 0;
  for (const doc of asRows<{ id: string; node_id: string; body: string }>(
    ctx.db
      .prepare(
        `SELECT d.id, d.node_id, d.body FROM document d
         JOIN node n ON n.id = d.node_id
         WHERE n.workspace_id = ? AND d.content_type = 'markdown'
           AND instr(d.body, '[[') > 0`,
      )
      .all(ctx.workspaceId),
  )) {
    const body = rewriteWikiLinks(doc.body, (link) => {
      if (resolveTarget(link.target, resolver) !== drop.id) return null;
      links++;
      // Un lien par titre garde le texte que l'on lisait.
      const text =
        link.text ?? (link.target.kind === 'title' ? link.target.title : null);
      return formatNodeLink(keep.id, text);
    });
    if (body === doc.body) continue;
    // Sans changer la date : le contenu du document n'est pas mis à jour.
    update.run(body, doc.id);
    nodeIds.add(doc.node_id);
  }
  return { links, nodeIds };
}

const CONFIDENCE_RANK = ['uncertain', 'probable', 'certain'];

/**
 * Relations de `drop` reportées sur `keep` : celle qui relierait le nœud à
 * lui-même disparaît ; celle qui existe déjà reçoit ce qui lui manque
 * (libellé, description, preuves) et la meilleure confiance des deux.
 */
function moveEdges(ctx: ServiceContext, keepId: string, dropId: string) {
  interface Edge {
    id: string;
    source_node_id: string;
    target_node_id: string;
    relation_type_id: string;
    label: string | null;
    description: string | null;
    confidence: string | null;
    from_link: number;
  }
  const { db } = ctx;
  for (const edge of asRows<Edge>(
    db
      .prepare(
        `SELECT id, source_node_id, target_node_id, relation_type_id, label,
           description, confidence, from_link
         FROM edge WHERE source_node_id = :id OR target_node_id = :id`,
      )
      .all({ id: dropId }),
  )) {
    const swap = (id: string) => (id === dropId ? keepId : id);
    const source = swap(edge.source_node_id);
    const target = swap(edge.target_node_id);
    if (source === target) {
      db.prepare('DELETE FROM edge WHERE id = ?').run(edge.id);
      continue;
    }
    const twin = asRow<Edge>(
      db
        .prepare(
          `SELECT * FROM edge WHERE source_node_id = ? AND target_node_id = ?
             AND relation_type_id = ? AND id <> ?`,
        )
        .get(source, target, edge.relation_type_id, edge.id),
    );
    if (!twin) {
      db.prepare(
        'UPDATE edge SET source_node_id = ?, target_node_id = ? WHERE id = ?',
      ).run(source, target, edge.id);
      continue;
    }
    const rank = (value: string | null) => CONFIDENCE_RANK.indexOf(value ?? '');
    db.prepare(
      `UPDATE edge SET label = coalesce(label, ?), description = coalesce(description, ?),
         confidence = ?, from_link = min(from_link, ?) WHERE id = ?`,
    ).run(
      edge.label,
      edge.description,
      rank(edge.confidence) > rank(twin.confidence)
        ? edge.confidence
        : twin.confidence,
      edge.from_link,
      twin.id,
    );
    db.prepare('UPDATE edge_evidence SET edge_id = ? WHERE edge_id = ?').run(
      twin.id,
      edge.id,
    );
    db.prepare('DELETE FROM edge WHERE id = ?').run(edge.id);
  }
}

/** Hiérarchie : les enfants de `drop` passent sous `keep`, sans cycle. */
function moveChildren(ctx: ServiceContext, keep: MergeRow, drop: MergeRow) {
  const { db } = ctx;
  const parentOf = db.prepare('SELECT parent_id FROM node WHERE id = ?');
  const ancestors: string[] = [];
  for (
    let id = keep.parent_id;
    id !== null && !ancestors.includes(id);
    id = (parentOf.get(id) as { parent_id: string | null }).parent_id
  ) {
    ancestors.push(id);
  }
  // `keep` était sous `drop` : il prend sa place.
  if (ancestors.includes(drop.id)) {
    db.prepare(
      'UPDATE node SET parent_id = ?, sort_order = ? WHERE id = ?',
    ).run(drop.parent_id, drop.sort_order, keep.id);
  }
  const last = db
    .prepare(
      'SELECT coalesce(max(sort_order), -1) AS n FROM node WHERE parent_id = ?',
    )
    .get(keep.id) as { n: number };
  db.prepare(
    'UPDATE node SET parent_id = ?, sort_order = sort_order + ? WHERE parent_id = ? AND id <> ?',
  ).run(keep.id, last.n + 1, drop.id, keep.id);
}

/**
 * Fusionne `dropId` dans `keepId`, en une transaction. Renvoie le nombre de
 * documents déplacés et de liens redirigés.
 */
export function mergeNodes(
  ctx: ServiceContext,
  keepId: string,
  dropId: string,
): { documents: number; links: number } {
  if (keepId === dropId) mergePreview(ctx, keepId, dropId);
  return inTransaction(ctx.db, () => {
    const { db } = ctx;
    const keep = nodeRow(ctx, keepId);
    const drop = nodeRow(ctx, dropId);
    const snapshots = new Map(
      withSnapshots(ctx, listAnchoredNodes(ctx, [keepId, dropId])).map(
        (node) => [node.nodeId, node.snapshot],
      ),
    );
    const redirected = redirectLinks(ctx, keep, drop);
    moveChildren(ctx, keep, drop);
    moveEdges(ctx, keepId, dropId);

    const last = db
      .prepare(
        'SELECT coalesce(max(sort_order), -1) AS n FROM document WHERE node_id = ?',
      )
      .get(keepId) as { n: number };
    const { changes } = db
      .prepare(
        'UPDATE document SET node_id = ?, sort_order = sort_order + ? WHERE node_id = ?',
      )
      .run(keepId, last.n + 1, dropId);
    const summary = drop.summary?.trim();
    if (summary && keep.summary?.trim() && keep.summary.trim() !== summary) {
      // Deux résumés : le second est gardé comme document.
      db.prepare(
        `INSERT INTO document (id, node_id, title, content_type, language, body, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, 'markdown', NULL, ?, ?, ?, ?)`,
      ).run(
        ctx.newId(),
        keepId,
        `Résumé de « ${drop.title} »`.slice(0, 200),
        `${summary}\n`,
        last.n + 1 + Number(changes),
        drop.updated_at,
        drop.updated_at,
      );
    }
    db.prepare('UPDATE attachment SET node_id = ? WHERE node_id = ?').run(
      keepId,
      dropId,
    );
    db.prepare(
      `UPDATE node SET summary = CASE WHEN trim(coalesce(summary, '')) = '' THEN ? ELSE summary END,
         color = coalesce(color, ?) WHERE id = ?`,
    ).run(drop.summary, drop.color, keepId);
    db.prepare(
      'INSERT OR IGNORE INTO node_tag (node_id, tag_id) SELECT ?, tag_id FROM node_tag WHERE node_id = ?',
    ).run(keepId, dropId);
    db.prepare(
      'INSERT OR IGNORE INTO lesson_node (lesson_id, node_id, files) SELECT lesson_id, ?, files FROM lesson_node WHERE node_id = ?',
    ).run(keepId, dropId);
    const anchors = [
      ...new Set([...listAnchors(ctx, keepId), ...listAnchors(ctx, dropId)]),
    ];
    if (anchors.length > ANCHORS_MAX_PER_NODE) {
      throw new NodalError(
        'LIMIT_EXCEEDED',
        `À eux deux, ils ont ${anchors.length} fichiers ou motifs ancrés (${ANCHORS_MAX_PER_NODE} au plus).`,
      );
    }
    setAnchors(ctx, keepId, anchors);

    new NodeService(() => ctx).delete({
      id: dropId,
      childrenStrategy: 'reparent',
    });
    const resolver = workspaceLinkResolver(ctx);
    for (const id of new Set([...redirected.nodeIds, keepId]))
      if (id !== dropId) syncNodeLinks(ctx, id, resolver);

    // Le code documenté reste celui d'avant : fusionner n'est pas relire.
    const states = [snapshots.get(dropId), snapshots.get(keepId)].filter(
      (state) => state !== undefined,
    );
    const [merged] = listAnchoredNodes(ctx, [keepId]);
    if (merged && states.length > 0) {
      saveSnapshot(ctx, keepId, {
        since: merged.since,
        patterns: [...new Set(states.flatMap((state) => state.patterns))],
        files: Object.assign({}, ...states.map((state) => state.files)),
      });
    }
    return { documents: Number(changes), links: redirected.links };
  });
}
