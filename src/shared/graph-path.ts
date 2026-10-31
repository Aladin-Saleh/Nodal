/**
 * Plus court chemin entre deux nœuds, par les relations (dans les deux sens)
 * et, en option, par les liens parent-enfant. Parcours en largeur : chaque
 * lien compte pour une étape. Logique pure, partagée par l'application et le
 * serveur MCP.
 */

/** Profondeur maximale acceptée (nombre de liens). */
export const PATH_MAX_DEPTH = 12;
export const PATH_DEFAULT_DEPTH = 6;

export interface PathGraphNode {
  id: string;
  parentId: string | null;
}

export interface PathGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationTypeId: string;
}

/** Lien emprunté pour arriver sur un nœud du chemin. */
export type PathLink =
  | {
      kind: 'relation';
      edgeId: string;
      relationTypeId: string;
      /** Vrai : parcourue de sa source vers sa cible. */
      forward: boolean;
    }
  /** Vers le parent (`parent`) ou vers un enfant (`child`). */
  | { kind: 'parent' | 'child' };

export interface PathStep {
  nodeId: string;
  /** `null` pour le nœud de départ. */
  via: PathLink | null;
}

export interface PathOptions {
  includeHierarchy: boolean;
  maxDepth: number;
}

/** Identifiant du lien hiérarchique d'un enfant (comme dans le graphe). */
export const hierarchyLinkId = (childId: string) => `hierarchy:${childId}`;

/**
 * Étapes du plus court chemin de `fromId` à `toId` (départ compris), ou
 * `null` s'il n'y en a pas en `maxDepth` liens au plus. À longueur égale,
 * depuis un même nœud, les relations sont essayées avant la hiérarchie, dans
 * l'ordre des données : le résultat est déterministe.
 */
export function shortestPath(
  nodes: readonly PathGraphNode[],
  edges: readonly PathGraphEdge[],
  fromId: string,
  toId: string,
  options: PathOptions,
): PathStep[] | null {
  const known = new Set(nodes.map((node) => node.id));
  if (!known.has(fromId) || !known.has(toId)) return null;
  if (fromId === toId) return [{ nodeId: fromId, via: null }];

  const adjacency = new Map<string, { to: string; link: PathLink }[]>();
  const add = (from: string, to: string, link: PathLink) => {
    if (!known.has(from) || !known.has(to)) return;
    const list = adjacency.get(from);
    if (list) list.push({ to, link });
    else adjacency.set(from, [{ to, link }]);
  };
  for (const edge of edges) {
    const base = { edgeId: edge.id, relationTypeId: edge.relationTypeId };
    add(edge.sourceId, edge.targetId, {
      kind: 'relation',
      ...base,
      forward: true,
    });
    add(edge.targetId, edge.sourceId, {
      kind: 'relation',
      ...base,
      forward: false,
    });
  }
  if (options.includeHierarchy) {
    for (const node of nodes) {
      if (node.parentId === null) continue;
      add(node.id, node.parentId, { kind: 'parent' });
      add(node.parentId, node.id, { kind: 'child' });
    }
  }

  const reached = new Map<string, { from: string; link: PathLink }>();
  let frontier = [fromId];
  for (
    let depth = 1;
    depth <= options.maxDepth && frontier.length > 0;
    depth++
  ) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const { to, link } of adjacency.get(id) ?? []) {
        if (to === fromId || reached.has(to)) continue;
        reached.set(to, { from: id, link });
        if (to === toId) return unwind(reached, fromId, toId);
        next.push(to);
      }
    }
    frontier = next;
  }
  return null;
}

function unwind(
  reached: Map<string, { from: string; link: PathLink }>,
  fromId: string,
  toId: string,
): PathStep[] {
  const steps: PathStep[] = [];
  for (let id = toId; id !== fromId;) {
    const step = reached.get(id)!;
    steps.push({ nodeId: id, via: step.link });
    id = step.from;
  }
  steps.push({ nodeId: fromId, via: null });
  return steps.toReversed();
}

/** Identifiants des liens du chemin, comme dans le graphe affiché. */
export function pathLinkIds(steps: readonly PathStep[]): string[] {
  return steps.slice(1).map((step, index) => {
    const via = step.via!;
    if (via.kind === 'relation') return via.edgeId;
    // L'enfant est le nœud d'arrivée (vers un enfant) ou de départ (vers le parent).
    return hierarchyLinkId(
      via.kind === 'child' ? step.nodeId : steps[index]!.nodeId,
    );
  });
}
