import type { NodeType } from '../../shared/domain';
import type { SearchHit, SearchMatch } from '../../shared/model';
import type { ContextProvider } from './context';
import { asRows } from './rows';

/** Nombre maximal de nœuds retournés. */
const MAX_HITS = 50;
/** Nombre maximal d'extraits par nœud. */
const MAX_MATCHES_PER_NODE = 3;
const MAX_TERMS = 12;

/**
 * Transforme une saisie libre en termes FTS5 sûrs : chaque mot devient un
 * préfixe entre guillemets, aucun opérateur FTS ne peut être injecté.
 */
export function searchTerms(input: string): string[] {
  const words = input.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(words)]
    .slice(0, MAX_TERMS)
    .map((word) => `"${word.replaceAll('"', '""')}"*`);
}

interface Row {
  kind: 'node' | 'document';
  item_id: string;
  node_id: string;
  rank: number;
  title_snippet: string;
  body_snippet: string;
  node_title: string;
  node_type: NodeType;
  document_title: string | null;
}

/** L'extrait contient-il un terme trouvé (marqueur de début) ? */
const hasMark = (text: string) => text.includes('\u0002');

/** Recherche plein texte dans les nœuds et documents (§6.9). */
export class SearchService {
  constructor(private readonly context: ContextProvider) {}

  /**
   * Un nœud est trouvé si chaque mot-clé apparaît dans son titre, son résumé
   * ou l'un de ses documents (pas forcément au même endroit). Les résultats
   * sont regroupés par nœud, du plus pertinent au moins pertinent.
   */
  search(input: string): SearchHit[] {
    const terms = searchTerms(input);
    if (terms.length === 0) return [];
    const ctx = this.context();

    const nodesMatching = ctx.db.prepare(
      `SELECT DISTINCT s.node_id FROM search_index s
       JOIN node n ON n.id = s.node_id AND n.workspace_id = ?
       WHERE search_index MATCH ?`,
    );
    let candidates = null as Set<string> | null;
    for (const term of terms) {
      const ids = new Set(
        asRows<{ node_id: string }>(
          nodesMatching.all(ctx.workspaceId, term),
        ).map((row) => row.node_id),
      );
      candidates = candidates
        ? new Set([...candidates].filter((id) => ids.has(id)))
        : ids;
      if (candidates.size === 0) return [];
    }
    const found = candidates ?? new Set<string>();

    const rows = asRows<Row>(
      ctx.db
        .prepare(
          `SELECT s.kind, s.item_id, s.node_id,
             bm25(search_index, 0, 0, 0, 4.0, 1.0) AS rank,
             snippet(search_index, 3, char(2), char(3), '…', 10) AS title_snippet,
             snippet(search_index, 4, char(2), char(3), '…', 14) AS body_snippet,
             n.title AS node_title, n.node_type AS node_type,
             d.title AS document_title
           FROM search_index s
           JOIN node n ON n.id = s.node_id AND n.workspace_id = ?
           LEFT JOIN document d ON s.kind = 'document' AND d.id = s.item_id
           WHERE search_index MATCH ?
           ORDER BY rank
           LIMIT 1000`,
        )
        .all(ctx.workspaceId, terms.join(' OR ')),
    );

    const hits = new Map<string, SearchHit>();
    for (const row of rows) {
      if (!found.has(row.node_id)) continue;
      let hit = hits.get(row.node_id);
      if (!hit) {
        if (hits.size >= MAX_HITS) continue;
        hit = {
          nodeId: row.node_id,
          nodeTitle: row.node_title,
          nodeType: row.node_type,
          matches: [],
        };
        hits.set(row.node_id, hit);
      }
      if (hit.matches.length >= MAX_MATCHES_PER_NODE) continue;
      const match: SearchMatch = {
        kind: row.kind,
        documentId: row.kind === 'document' ? row.item_id : null,
        documentTitle: row.document_title,
        snippet: hasMark(row.body_snippet)
          ? row.body_snippet
          : row.title_snippet,
      };
      hit.matches.push(match);
    }
    return [...hits.values()];
  }
}
