/**
 * Identifiants courts pour le LLM. Un UUID coûte une vingtaine de tokens
 * (hexadécimal aléatoire, mal découpé par les tokenizers) et représente
 * l'essentiel d'une réponse tabulaire. Le serveur affiche donc le plus court
 * préfixe unique de chaque UUID (8 caractères au moins, allongé en cas de
 * collision) et accepte en entrée un préfixe comme un UUID complet.
 *
 * Les préfixes sont calculés sur tous les identifiants de l'espace (nœuds,
 * documents, relations, pièces jointes) : un préfixe désigne un seul élément,
 * quel que soit son type. Un préfixe affiché reste valable tant qu'aucun
 * nouvel identifiant ne le partage ; sinon il devient ambigu et l'erreur le
 * dit. Les UUID complets restent toujours acceptés.
 */
import { NodalError } from '../shared/errors';
import { asRows } from '../main/knowledge/rows';
import type { ReadContext } from './workspace-reader';

export const MIN_SHORT_ID_LENGTH = 8;

/** Champs des réponses qui contiennent un identifiant. */
const OUTPUT_ID_KEYS = new Set([
  'id',
  'parentId',
  'nodeId',
  'documentId',
  'otherId',
  'sourceId',
  'targetId',
]);

/** Arguments des outils qui désignent un élément. */
const INPUT_ID_KEYS = new Set([
  'id',
  'rootId',
  'nodeId',
  'parentId',
  'sourceId',
  'targetId',
]);

export interface ShortIds {
  short(id: string): string;
  resolve(value: string): string;
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function loadShortIds(ctx: ReadContext): ShortIds {
  const ids = asRows<{ id: string }>(
    ctx.db
      .prepare(
        `SELECT id FROM node WHERE workspace_id = :w
         UNION ALL SELECT d.id FROM document d JOIN node n ON n.id = d.node_id WHERE n.workspace_id = :w
         UNION ALL SELECT id FROM edge WHERE workspace_id = :w
         UNION ALL SELECT a.id FROM attachment a
           LEFT JOIN node n ON n.id = a.node_id
           LEFT JOIN document d ON d.id = a.document_id
           LEFT JOIN node dn ON dn.id = d.node_id
           WHERE COALESCE(n.workspace_id, dn.workspace_id) = :w`,
      )
      .all({ w: ctx.workspaceId }),
  )
    .map((row) => row.id)
    .toSorted();

  // Plus court préfixe unique : il suffit de se distinguer des voisins dans
  // l'ordre trié.
  const shortById = new Map<string, string>();
  ids.forEach((id, index) => {
    const before = index > 0 ? commonPrefixLength(id, ids[index - 1]!) : 0;
    const after =
      index < ids.length - 1 ? commonPrefixLength(id, ids[index + 1]!) : 0;
    const length = Math.max(MIN_SHORT_ID_LENGTH, before + 1, after + 1);
    shortById.set(id, id.slice(0, Math.min(length, id.length)));
  });

  return {
    short: (id) => shortById.get(id) ?? id,
    resolve(value) {
      const prefix = value.trim().toLowerCase();
      if (shortById.has(prefix)) return prefix;
      const matches = ids.filter((id) => id.startsWith(prefix));
      if (matches.length === 1) return matches[0]!;
      if (matches.length > 1) {
        throw new NodalError(
          'VALIDATION_ERROR',
          `Identifiant « ${value} » ambigu : il désigne ${matches.length} éléments. Donnez plus de caractères.`,
        );
      }
      // Inconnu : laissé tel quel, le service répondra « introuvable ».
      return value;
    },
  };
}

/** Raccourcit les identifiants d'une réponse (copie profonde). */
export function shortenIds(data: unknown, ids: ShortIds): unknown {
  if (Array.isArray(data)) return data.map((item) => shortenIds(item, ids));
  if (data === null || typeof data !== 'object') return data;
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      OUTPUT_ID_KEYS.has(key) && typeof value === 'string'
        ? ids.short(value)
        : shortenIds(value, ids),
    ]),
  );
}

/** Remplace les préfixes des arguments d'un outil par les UUID complets. */
export function resolveIds<A>(args: A, ids: ShortIds): A {
  if (args === null || typeof args !== 'object') return args;
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => [
      key,
      INPUT_ID_KEYS.has(key) && typeof value === 'string'
        ? ids.resolve(value)
        : value,
    ]),
  ) as A;
}
