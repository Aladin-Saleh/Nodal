/**
 * Liens vers un nœud, cliquables hors de Nodal (navigateur, ticket, terminal) :
 * `nodal://node/<id du nœud>?espace=<id de l'espace>`. Un lien ne fait
 * qu'ouvrir l'espace (parmi les récents) et sélectionner le nœud.
 */

export const NODE_LINK_SCHEME = 'nodal';

/** Identifiant de nœud ou d'espace accepté dans un lien. */
const ID_PATTERN = /^[\w-]{1,100}$/u;
/**
 * Un nœud peut être désigné par le début de son identifiant (identifiants
 * abrégés du serveur MCP, cités par un assistant) : 8 caractères au moins.
 */
export const NODE_LINK_MIN_PREFIX = 8;

export interface NodeLink {
  nodeId: string;
  /** `null` : espace non précisé (cherché parmi les récents). */
  workspaceId: string | null;
}

export function buildNodeLink(nodeId: string, workspaceId: string): string {
  return `${NODE_LINK_SCHEME}://node/${encodeURIComponent(nodeId)}?espace=${encodeURIComponent(workspaceId)}`;
}

/** Lien analysé, ou `null` s'il n'est pas un lien de nœud valide. */
export function parseNodeLink(raw: string): NodeLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== `${NODE_LINK_SCHEME}:` || url.hostname !== 'node') {
    return null;
  }
  const nodeId = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/gu, ''));
  const workspaceId = url.searchParams.get('espace');
  if (!ID_PATTERN.test(nodeId) || nodeId.length < NODE_LINK_MIN_PREFIX) {
    return null;
  }
  if (workspaceId !== null && !ID_PATTERN.test(workspaceId)) return null;
  return { nodeId, workspaceId };
}

/** Liens de nœud dans un texte (sortie d'un terminal) : début et longueur. */
export const NODE_LINK_PATTERN = /nodal:\/\/node\/[\w-]+(?:\?espace=[\w-]+)?/gu;

/** Où ouvrir un nœud demandé par un lien (main → renderer). */
export type NodeLinkTarget =
  | {
      kind: 'node';
      nodeId: string;
      workspaceId: string;
      /** Espace récent à ouvrir ; `null` : l'espace déjà ouvert. */
      recentId: string | null;
    }
  | { kind: 'missing'; message: string };
