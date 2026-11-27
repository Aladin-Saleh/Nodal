/**
 * Liens `nodal://node/…` reçus de Windows (lancement ou seconde instance) :
 * l'espace qui contient le nœud est cherché dans l'espace ouvert puis parmi
 * les espaces récents, lus en lecture seule. Jamais de chemin dans un lien :
 * une page web ne peut faire ouvrir qu'un espace déjà ouvert par l'utilisateur.
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { RecentWorkspace } from '../shared/model';
import {
  NODE_LINK_SCHEME,
  parseNodeLink,
  type NodeLink,
  type NodeLinkTarget,
} from '../shared/node-links';
import { NODAL_APPLICATION_ID, getApplicationId } from './database/connection';

/** Premier lien de nœud parmi les arguments de la ligne de commande. */
export function nodeLinkInArgs(args: readonly string[]): string | null {
  return (
    args.find((arg) =>
      arg.toLowerCase().startsWith(`${NODE_LINK_SCHEME}://`),
    ) ?? null
  );
}

/** Nœud trouvé (identifiant complet et espace), ou plusieurs (préfixe ambigu). */
type Found = { nodeId: string; workspaceId: string } | 'ambiguous' | null;

/**
 * Nœud désigné par le lien dans une base : identifiant complet ou début
 * d'identifiant, dans l'espace demandé s'il est précisé.
 */
function findNode(db: DatabaseSync, link: NodeLink): Found {
  // `~` suit tous les caractères d'un identifiant : borne du préfixe.
  const rows = db
    .prepare(
      `SELECT id AS nodeId, workspace_id AS workspaceId FROM node
       WHERE id >= :prefix AND id < :prefix || '~'
         AND (:workspace IS NULL OR workspace_id = :workspace)
       ORDER BY id = :prefix DESC
       LIMIT 2`,
    )
    .all({ prefix: link.nodeId, workspace: link.workspaceId }) as {
    nodeId: string;
    workspaceId: string;
  }[];
  const [first, second] = rows;
  if (!first) return null;
  if (first.nodeId === link.nodeId || !second) return first;
  return 'ambiguous';
}

/** Même recherche dans un fichier .nodal fermé, ouvert en lecture seule. */
function findNodeInFile(file: string, link: NodeLink): Found {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA trusted_schema = OFF');
    if (getApplicationId(db) !== NODAL_APPLICATION_ID) return null;
    return findNode(db, link);
  } catch {
    // Illisible, verrouillé ou d'une autre version : ignoré.
    return null;
  } finally {
    db?.close();
  }
}

export interface NodeLinkSources {
  /** Espace ouvert : identifiant et base. */
  current(): { id: string; db: DatabaseSync } | null;
  recent(): RecentWorkspace[];
}

const AMBIGUOUS: NodeLinkTarget = {
  kind: 'missing',
  message:
    'Ce lien abrégé désigne plusieurs nœuds : utilisez « Copier le lien » pour un lien complet.',
};

export function resolveNodeLink(
  raw: string,
  sources: NodeLinkSources,
): NodeLinkTarget {
  const link = parseNodeLink(raw);
  if (!link) {
    return { kind: 'missing', message: 'Lien Nodal invalide.' };
  }
  const current = sources.current();
  if (current) {
    const found = findNode(current.db, link);
    if (found === 'ambiguous') return AMBIGUOUS;
    if (found) return { kind: 'node', ...found, recentId: null };
  }
  for (const entry of sources.recent()) {
    if (!entry.exists || !fs.existsSync(entry.filePath)) continue;
    const found = findNodeInFile(entry.filePath, link);
    if (found === 'ambiguous') return AMBIGUOUS;
    if (found && found.workspaceId !== current?.id) {
      return { kind: 'node', ...found, recentId: entry.id };
    }
  }
  return {
    kind: 'missing',
    message:
      'Ce nœud n’est dans aucun espace récent : ouvrez d’abord son espace dans Nodal.',
  };
}
