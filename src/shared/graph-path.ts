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
  /** Suivre les relations dans leur sens seulement. */
  directed?: boolean;
  /** Types de relation vagues (« est lié à ») : évités à longueur égale. */
  vagueTypes?: ReadonlySet<string>;
}

export interface FoundPath {
  steps: PathStep[];
  /** Nombre de chemins de cette longueur, celui-ci compris. */
  routes: number;
}

/** Chemin retenu jusqu'à un nœud, pendant le parcours. */
interface Reached {
  from: string;
  link: PathLink;
  depth: number;
  /** Liens vagues ou hiérarchiques, puis relations des nœuds traversés. */
  vague: number;
  hubs: number;
  routes: number;
}

/** Identifiant du lien hiérarchique d'un enfant (comme dans le graphe). */
export const hierarchyLinkId = (childId: string) => `hierarchy:${childId}`;

/** Plus court chemin (voir findShortestPath), sans le nombre d'ex æquo. */
export function shortestPath(
  nodes: readonly PathGraphNode[],
  edges: readonly PathGraphEdge[],
  fromId: string,
  toId: string,
  options: PathOptions,
): PathStep[] | null {
  return findShortestPath(nodes, edges, fromId, toId, options)?.steps ?? null;
}

/**
 * Plus court chemin de `fromId` à `toId` (départ compris), ou `null` s'il n'y
 * en a pas en `maxDepth` liens au plus. À longueur égale, celui qui en dit le
 * plus : le moins de liens vagues ou hiérarchiques, puis les nœuds traversés
 * les moins reliés (un nœud relié à tout n'explique rien), enfin l'ordre des
 * données : le résultat est déterministe. Les ex æquo sont départagés nœud
 * par nœud pendant le parcours, sans énumérer les chemins.
 */
export function findShortestPath(
  nodes: readonly PathGraphNode[],
  edges: readonly PathGraphEdge[],
  fromId: string,
  toId: string,
  options: PathOptions,
): FoundPath | null {
  const known = new Set(nodes.map((node) => node.id));
  if (!known.has(fromId) || !known.has(toId)) return null;
  if (fromId === toId)
    return { steps: [{ nodeId: fromId, via: null }], routes: 1 };

  const adjacency = new Map<string, { to: string; link: PathLink }[]>();
  const degree = new Map<string, number>();
  const add = (from: string, to: string, link: PathLink) => {
    if (!known.has(from) || !known.has(to)) return;
    const list = adjacency.get(from);
    if (list) list.push({ to, link });
    else adjacency.set(from, [{ to, link }]);
  };
  for (const edge of edges) {
    for (const id of [edge.sourceId, edge.targetId])
      degree.set(id, (degree.get(id) ?? 0) + 1);
    const base = {
      kind: 'relation' as const,
      edgeId: edge.id,
      relationTypeId: edge.relationTypeId,
    };
    add(edge.sourceId, edge.targetId, { ...base, forward: true });
    if (!options.directed)
      add(edge.targetId, edge.sourceId, { ...base, forward: false });
  }
  if (options.includeHierarchy) {
    for (const node of nodes) {
      if (node.parentId === null) continue;
      add(node.id, node.parentId, { kind: 'parent' });
      add(node.parentId, node.id, { kind: 'child' });
    }
  }
  const isVague = (link: PathLink) =>
    link.kind !== 'relation' ||
    (options.vagueTypes?.has(link.relationTypeId) ?? false);

  const reached = new Map<string, Reached>();
  let frontier = [fromId];
  for (
    let depth = 1;
    depth <= options.maxDepth && frontier.length > 0 && !reached.has(toId);
    depth++
  ) {
    const next: string[] = [];
    for (const id of frontier) {
      const before = reached.get(id);
      // Plusieurs relations entre deux nœuds : un seul chemin.
      const counted = new Set<string>();
      for (const { to, link } of adjacency.get(id) ?? []) {
        if (to === fromId) continue;
        const current = reached.get(to);
        if (current && current.depth < depth) continue;
        const candidate: Reached = {
          from: id,
          link,
          depth,
          vague: (before?.vague ?? 0) + (isVague(link) ? 1 : 0),
          hubs:
            (before?.hubs ?? 0) + (id === fromId ? 0 : (degree.get(id) ?? 0)),
          routes:
            (current?.routes ?? 0) +
            (counted.has(to) ? 0 : (before?.routes ?? 1)),
        };
        counted.add(to);
        if (!current) next.push(to);
        const better =
          !current ||
          candidate.vague < current.vague ||
          (candidate.vague === current.vague && candidate.hubs < current.hubs);
        reached.set(
          to,
          better ? candidate : { ...current, routes: candidate.routes },
        );
      }
    }
    frontier = next;
  }
  const end = reached.get(toId);
  return end
    ? { steps: unwind(reached, fromId, toId), routes: end.routes }
    : null;
}

function unwind(
  reached: ReadonlyMap<string, Reached>,
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
