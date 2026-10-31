/**
 * Liens [[...]] des documents Markdown côté données : relations « est lié
 * à » maintenues d'après les liens (`edge.from_link`, migration 007) et
 * rétroliens (« Mentionné dans »).
 */
import type { Backlink } from '../../shared/model';
import {
  createLinkResolver,
  linkedNodeIds,
  parseWikiLinks,
  resolveTarget,
  rewriteWikiLinks,
  type LinkResolver,
} from '../../shared/wiki-links';
import type { ServiceContext } from './context';
import { asRows } from './rows';

/** Type des relations créées par les liens (créé s'il a disparu). */
export const LINK_RELATION_NAME = 'est lié à';

/** Résolveur des liens sur les nœuds de l'espace (ordre de création). */
export function workspaceLinkResolver(ctx: ServiceContext): LinkResolver {
  return createLinkResolver(
    asRows<{ id: string; title: string }>(
      ctx.db
        .prepare(
          'SELECT id, title FROM node WHERE workspace_id = ? ORDER BY rowid',
        )
        .all(ctx.workspaceId),
    ),
  );
}

export function linkRelationTypeId(ctx: ServiceContext): string {
  const found = ctx.db
    .prepare(
      'SELECT id FROM relation_type WHERE workspace_id = ? AND name = ? COLLATE NOCASE',
    )
    .get(ctx.workspaceId, LINK_RELATION_NAME) as { id: string } | undefined;
  if (found) return found.id;
  const id = ctx.newId();
  ctx.db
    .prepare(
      'INSERT INTO relation_type (id, workspace_id, name, color, is_builtin) VALUES (?, ?, ?, NULL, 1)',
    )
    .run(id, ctx.workspaceId, LINK_RELATION_NAME);
  return id;
}

/**
 * Met les relations issues des liens du nœud en accord avec ses documents
 * Markdown : une relation « est lié à » par nœud visé, retirée quand plus
 * aucun lien n'y mène. Les relations créées à la main ne sont jamais
 * modifiées ; si l'une relie déjà les deux nœuds avec ce type, aucune
 * relation n'est ajoutée. À appeler dans la transaction de l'écriture.
 */
export function syncNodeLinks(
  ctx: ServiceContext,
  nodeId: string,
  resolver: LinkResolver = workspaceLinkResolver(ctx),
): { added: number; removed: number } {
  const bodies = asRows<{ body: string }>(
    ctx.db
      .prepare(
        "SELECT body FROM document WHERE node_id = ? AND content_type = 'markdown'",
      )
      .all(nodeId),
  );
  const wanted = new Set(
    bodies.flatMap(({ body }) => linkedNodeIds(body, resolver)),
  );
  wanted.delete(nodeId);
  const existing = asRows<{
    id: string;
    target_node_id: string;
    from_link: number;
    relation_type_id: string;
  }>(
    ctx.db
      .prepare(
        'SELECT id, target_node_id, from_link, relation_type_id FROM edge WHERE source_node_id = ?',
      )
      .all(nodeId),
  );
  let removed = 0;
  for (const edge of existing) {
    if (edge.from_link === 1 && !wanted.has(edge.target_node_id)) {
      ctx.db.prepare('DELETE FROM edge WHERE id = ?').run(edge.id);
      removed++;
    }
  }
  if (wanted.size === 0) return { added: 0, removed };
  const typeId = linkRelationTypeId(ctx);
  const covered = new Set(
    existing
      .filter((edge) => edge.relation_type_id === typeId)
      .map((edge) => edge.target_node_id),
  );
  const insert = ctx.db.prepare(
    `INSERT INTO edge (id, workspace_id, source_node_id, target_node_id, relation_type_id, label, description, created_at, updated_at, from_link)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 1)`,
  );
  let added = 0;
  const now = ctx.now();
  for (const target of wanted) {
    if (covered.has(target)) continue;
    insert.run(ctx.newId(), ctx.workspaceId, nodeId, target, typeId, now, now);
    added++;
  }
  return { added, removed };
}

const SNIPPET_RADIUS = 60;

/** Texte lisible d'un lien : texte donné, sinon titre du nœud visé. */
export function linkLabel(
  text: string | null,
  targetId: string | null,
  rawTitle: string | null,
  resolver: LinkResolver,
): string {
  if (text) return text;
  if (targetId) return resolver.titleOf(targetId) ?? rawTitle ?? '';
  return rawTitle ?? '';
}

/**
 * Liens du texte remplacés par `[[libellé]]` : extraits et exports lisibles
 * sans identifiant (les liens par titre restent tels quels).
 */
export function readableLinks(body: string, resolver: LinkResolver): string {
  return rewriteWikiLinks(body, (link) => {
    const id = resolveTarget(link.target, resolver);
    const title = link.target.kind === 'title' ? link.target.title : null;
    return `[[${linkLabel(link.text, id, title, resolver)}]]`;
  });
}

/**
 * Documents (Markdown) qui contiennent un lien vers ce nœud, avec un extrait
 * autour du premier lien. Candidats trouvés par SQL (identifiant ou titre
 * dans le texte), puis confirmés par l'analyse des liens.
 */
export function listBacklinks(
  ctx: ServiceContext,
  nodeId: string,
  resolver: LinkResolver = workspaceLinkResolver(ctx),
): Backlink[] {
  const title = resolver.titleOf(nodeId);
  if (title === undefined) return [];
  const rows = asRows<{
    document_id: string;
    document_title: string;
    node_id: string;
    node_title: string;
    body: string;
  }>(
    ctx.db
      .prepare(
        `SELECT d.id AS document_id, d.title AS document_title, n.id AS node_id,
           n.title AS node_title, d.body
         FROM document d JOIN node n ON n.id = d.node_id
         WHERE n.workspace_id = :ws AND d.content_type = 'markdown'
           AND (instr(d.body, :byId) > 0 OR instr(lower(d.body), lower(:byTitle)) > 0)
         ORDER BY n.title COLLATE NOCASE, d.sort_order`,
      )
      .all({
        ws: ctx.workspaceId,
        byId: `node:${nodeId}`,
        byTitle: `[[${title.trim()}`,
      }),
  );
  const result: Backlink[] = [];
  for (const row of rows) {
    const link = parseWikiLinks(row.body).find(
      (candidate) => resolveTarget(candidate.target, resolver) === nodeId,
    );
    if (!link) continue;
    const from = Math.max(0, link.start - SNIPPET_RADIUS);
    const to = Math.min(row.body.length, link.end + SNIPPET_RADIUS);
    const snippet = readableLinks(row.body.slice(from, to), resolver)
      .replace(/\s+/g, ' ')
      .trim();
    result.push({
      nodeId: row.node_id,
      nodeTitle: row.node_title,
      documentId: row.document_id,
      documentTitle: row.document_title,
      snippet: `${from > 0 ? '…' : ''}${snippet}${to < row.body.length ? '…' : ''}`,
    });
  }
  return result;
}
