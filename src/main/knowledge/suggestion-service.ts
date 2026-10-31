/**
 * Suggestions de liens (« Relier ? ») : documents Markdown ou texte d'un
 * nœud qui citent le titre d'un autre nœud alors qu'aucune relation ne les
 * relie. Calcul pour un seul nœud à la fois (ses documents face aux titres
 * de l'espace) : à l'affichage de son panneau et après l'enregistrement de
 * ses documents, jamais de parcours complet de la base.
 */
import { NodalError } from '../../shared/errors';
import {
  findTitleMention,
  mentionIndex,
  mentionSnippet,
  suggestibleTitle,
} from '../../shared/link-suggestions';
import type { LinkSuggestion } from '../../shared/model';
import { formatNodeLink } from '../../shared/wiki-links';
import { inTransaction } from '../database/transaction';
import { notFound, type ContextProvider, type ServiceContext } from './context';
import { DocumentService } from './document-service';
import { EdgeService } from './edge-service';
import { linkRelationTypeId } from './link-service';
import { asRows } from './rows';

/** Suggestions affichées au plus par nœud. */
export const SUGGESTION_LIMIT = 20;

interface Candidate {
  id: string;
  title: string;
  folded: string;
}

interface DocumentRow {
  id: string;
  title: string;
  body: string;
}

function documentsOf(ctx: ServiceContext, nodeId: string): DocumentRow[] {
  return asRows<DocumentRow>(
    ctx.db
      .prepare(
        `SELECT id, title, body FROM document
         WHERE node_id = ? AND content_type IN ('markdown', 'text')
         ORDER BY sort_order, rowid`,
      )
      .all(nodeId),
  );
}

/**
 * Nœuds proposables depuis `nodeId` : ni lui-même, ni son parent ou ses
 * enfants, ni un nœud déjà relié (dans un sens ou l'autre), ni un refus.
 */
function candidates(ctx: ServiceContext, nodeId: string): Candidate[] {
  const rows = asRows<{ id: string; title: string }>(
    ctx.db
      .prepare(
        `SELECT n.id, n.title FROM node n
         WHERE n.workspace_id = :ws AND n.id != :id
           AND n.id IS NOT (SELECT parent_id FROM node WHERE id = :id)
           AND (n.parent_id IS NULL OR n.parent_id != :id)
           AND NOT EXISTS (SELECT 1 FROM edge e
             WHERE (e.source_node_id = :id AND e.target_node_id = n.id)
                OR (e.source_node_id = n.id AND e.target_node_id = :id))
           AND NOT EXISTS (SELECT 1 FROM link_suggestion_ignored i
             WHERE i.source_node_id = :id AND i.target_node_id = n.id)
         ORDER BY n.rowid`,
      )
      .all({ ws: ctx.workspaceId, id: nodeId }),
  );
  return rows.flatMap((row) => {
    const folded = suggestibleTitle(row.title);
    return folded ? [{ id: row.id, title: row.title, folded }] : [];
  });
}

/** Suggestions du nœud, dans l'ordre de ses documents puis du texte. */
export function suggestionsForNode(
  ctx: ServiceContext,
  nodeId: string,
): LinkSuggestion[] {
  const docs = documentsOf(ctx, nodeId).filter((doc) => doc.body.trim());
  if (docs.length === 0) return [];
  const remaining = candidates(ctx, nodeId);
  const found: (LinkSuggestion & { at: number })[] = [];
  docs.forEach((doc, docIndex) => {
    if (remaining.length === 0) return;
    const index = mentionIndex(doc.body);
    for (let i = remaining.length - 1; i >= 0; i--) {
      const candidate = remaining[i]!;
      const mention = findTitleMention(index, candidate.folded);
      if (!mention) continue;
      remaining.splice(i, 1);
      found.push({
        targetId: candidate.id,
        targetTitle: candidate.title,
        documentId: doc.id,
        documentTitle: doc.title,
        snippet: mentionSnippet(doc.body, mention),
        at: docIndex * 1e9 + mention.start,
      });
    }
  });
  return found
    .toSorted((a, b) => a.at - b.at)
    .slice(0, SUGGESTION_LIMIT)
    .map(({ at: _at, ...suggestion }) => suggestion);
}

export class SuggestionService {
  constructor(private readonly context: ContextProvider) {}

  listForNode(nodeId: string): LinkSuggestion[] {
    const ctx = this.context();
    if (
      !ctx.db
        .prepare('SELECT 1 FROM node WHERE id = ? AND workspace_id = ?')
        .get(nodeId, ctx.workspaceId)
    ) {
      throw notFound('Nœud');
    }
    return suggestionsForNode(ctx, nodeId);
  }

  /**
   * Accepte une suggestion : relation « est lié à » créée à la main
   * (`relation`), ou première mention convertie en lien [[...]] (`link`),
   * qui crée sa relation issue du lien.
   */
  accept(input: {
    sourceId: string;
    targetId: string;
    mode: 'relation' | 'link';
  }): void {
    const ctx = this.context();
    const suggestion = suggestionsForNode(ctx, input.sourceId).find(
      (candidate) => candidate.targetId === input.targetId,
    );
    if (!suggestion) {
      throw new NodalError(
        'CONFLICT',
        'Cette suggestion n’est plus d’actualité (document modifié ou nœuds déjà reliés).',
      );
    }
    inTransaction(ctx.db, () => {
      if (input.mode === 'relation') {
        new EdgeService(this.context).create({
          sourceId: input.sourceId,
          targetId: input.targetId,
          relationTypeId: linkRelationTypeId(ctx),
        });
        return;
      }
      const documents = new DocumentService(this.context);
      const doc = documents.get(suggestion.documentId);
      const target = ctx.db
        .prepare('SELECT title FROM node WHERE id = ?')
        .get(input.targetId) as { title: string };
      const mention = findTitleMention(
        mentionIndex(doc.body),
        suggestibleTitle(target.title)!,
      )!;
      const original = doc.body.slice(mention.start, mention.end);
      // Le texte d'origine reste affiché s'il diffère du titre (casse, accords).
      const link = formatNodeLink(
        input.targetId,
        original === target.title ? null : original,
      );
      documents.update({
        id: doc.id,
        body:
          doc.body.slice(0, mention.start) + link + doc.body.slice(mention.end),
      });
    });
  }

  /** Ne plus proposer ce nœud depuis ce nœud. */
  ignore(input: { sourceId: string; targetId: string }): void {
    const ctx = this.context();
    ctx.db
      .prepare(
        `INSERT INTO link_suggestion_ignored (source_node_id, target_node_id, created_at)
         VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(input.sourceId, input.targetId, ctx.now());
  }
}
