/**
 * Logique pure de la vue graphe : portée (espace entier ou voisinage),
 * filtres et positions de départ des nœuds sans position 3D.
 */
import type { NodeType } from '../../../shared/domain';
import type {
  EdgeInfo,
  GraphData,
  GraphNode,
  NodePosition,
} from '../../../shared/model';

export type GraphScope =
  | { kind: 'all' }
  | { kind: 'neighborhood'; centerId: string; depth: number };

export interface GraphFilters {
  /** Types de nœuds affichés (tous si l'ensemble est vide). */
  nodeTypes: ReadonlySet<NodeType>;
  /** Un nœud est affiché s'il porte au moins un de ces tags (tous si vide). */
  tagIds: ReadonlySet<string>;
  /** Types de relations masqués. */
  hiddenRelationTypeIds: ReadonlySet<string>;
  /** Affiche les liens parent → enfant (en pointillés). */
  showHierarchy: boolean;
}

export const DEFAULT_FILTERS: GraphFilters = {
  nodeTypes: new Set(),
  tagIds: new Set(),
  hiddenRelationTypeIds: new Set(),
  showHierarchy: true,
};

/** Au-delà, la vue démarre sur le voisinage du nœud sélectionné (§7.1). */
export const LARGE_GRAPH_THRESHOLD = 200;

export interface HierarchyLink {
  id: string;
  parentId: string;
  childId: string;
}

export interface VisibleGraph {
  nodes: GraphNode[];
  edges: EdgeInfo[];
  hierarchy: HierarchyLink[];
}

/**
 * Nœuds à au plus `depth` sauts du centre, en suivant les relations dans les
 * deux sens (et la hiérarchie si demandé).
 */
export function neighborhood(
  graph: GraphData,
  centerId: string,
  depth: number,
  edges: readonly EdgeInfo[],
  followHierarchy: boolean,
): Set<string> {
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const edge of edges) {
    link(edge.sourceId, edge.targetId);
    link(edge.targetId, edge.sourceId);
  }
  if (followHierarchy) {
    for (const node of graph.nodes) {
      if (node.parentId) {
        link(node.parentId, node.id);
        link(node.id, node.parentId);
      }
    }
  }

  const visited = new Set([centerId]);
  let frontier = [centerId];
  for (let level = 0; level < depth && frontier.length > 0; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return visited;
}

/** Applique filtres et portée. Le nœud central reste toujours visible. */
export function visibleGraph(
  graph: GraphData,
  scope: GraphScope,
  filters: GraphFilters,
): VisibleGraph {
  const centerId = scope.kind === 'neighborhood' ? scope.centerId : null;
  const matches = (node: GraphNode) =>
    node.id === centerId ||
    ((filters.nodeTypes.size === 0 || filters.nodeTypes.has(node.nodeType)) &&
      (filters.tagIds.size === 0 ||
        node.tagIds.some((tagId) => filters.tagIds.has(tagId))));

  const candidates = new Set(
    graph.nodes.filter(matches).map((node) => node.id),
  );
  const edgeVisible = (edge: EdgeInfo) =>
    !filters.hiddenRelationTypeIds.has(edge.relationTypeId) &&
    candidates.has(edge.sourceId) &&
    candidates.has(edge.targetId);
  const candidateEdges = graph.edges.filter(edgeVisible);

  let ids = candidates;
  if (scope.kind === 'neighborhood' && candidates.has(scope.centerId)) {
    const filteredGraph: GraphData = {
      ...graph,
      nodes: graph.nodes.filter((node) => candidates.has(node.id)),
    };
    ids = neighborhood(
      filteredGraph,
      scope.centerId,
      scope.depth,
      candidateEdges,
      filters.showHierarchy,
    );
  }

  const nodes = graph.nodes.filter((node) => ids.has(node.id));
  const edges = candidateEdges.filter(
    (edge) => ids.has(edge.sourceId) && ids.has(edge.targetId),
  );
  const hierarchy = filters.showHierarchy
    ? nodes
        .filter((node) => node.parentId !== null && ids.has(node.parentId))
        .map((node) => ({
          id: `hierarchy:${node.id}`,
          parentId: node.parentId!,
          childId: node.id,
        }))
    : [];
  return { nodes, edges, hierarchy };
}

/** Distance entre un nouveau nœud et le voisin près duquel il apparaît. */
export const SEED_DISTANCE = 45;

export function hasPosition(
  node: GraphNode,
): node is GraphNode & { x: number; y: number; z: number } {
  return node.x !== null && node.y !== null && node.z !== null;
}

/** Point n° `rank` réparti sur une sphère (spirale de Fibonacci). */
function spherePoint(rank: number, count: number) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - ((rank + 0.5) / count) * 2;
  const radius = Math.sqrt(1 - y * y);
  const theta = golden * rank;
  return { x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius };
}

/**
 * Position de départ des nœuds sans position 3D : à côté d'un voisin déjà
 * placé (parent, puis extrémité d'une relation), sinon à côté de
 * l'ensemble. La simulation de forces affine ensuite ces positions.
 * Retourne une liste vide si aucun nœud visible n'est placé : il faut alors
 * une disposition complète.
 */
export function seedPositions(visible: VisibleGraph): NodePosition[] {
  const known = new Map<string, { x: number; y: number; z: number }>();
  for (const node of visible.nodes) {
    if (hasPosition(node))
      known.set(node.id, { x: node.x, y: node.y, z: node.z });
  }
  if (known.size === 0) return [];

  const neighbors = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = neighbors.get(a);
    if (list) list.push(b);
    else neighbors.set(a, [b]);
  };
  for (const node of visible.nodes) {
    if (node.parentId) link(node.id, node.parentId);
  }
  for (const edge of visible.edges) {
    link(edge.sourceId, edge.targetId);
    link(edge.targetId, edge.sourceId);
  }

  const points = [...known.values()];
  const maxX = Math.max(...points.map((point) => point.x));
  const placedAround = new Map<string, number>();
  let freeSlot = 0;
  const placed: NodePosition[] = [];

  // Plusieurs passes : un nœud peut être placé à côté d'un nœud placé juste avant.
  let pending = visible.nodes.filter((node) => !known.has(node.id));
  for (let pass = 0; pass < 3 && pending.length > 0; pass++) {
    const remaining: GraphNode[] = [];
    for (const node of pending) {
      const anchorId = (neighbors.get(node.id) ?? []).find((id) =>
        known.has(id),
      );
      if (!anchorId) {
        remaining.push(node);
        continue;
      }
      const anchor = known.get(anchorId)!;
      const rank = placedAround.get(anchorId) ?? 0;
      placedAround.set(anchorId, rank + 1);
      const direction = spherePoint(rank % 12, 12);
      const ring = 1 + Math.floor(rank / 12);
      const point = {
        x: Math.round(anchor.x + direction.x * SEED_DISTANCE * ring),
        y: Math.round(anchor.y + direction.y * SEED_DISTANCE * ring),
        z: Math.round(anchor.z + direction.z * SEED_DISTANCE * ring),
      };
      known.set(node.id, point);
      placed.push({ id: node.id, ...point });
    }
    pending = remaining;
  }
  for (const node of pending) {
    const direction = spherePoint(freeSlot % 12, 12);
    const point = {
      x: Math.round(maxX + SEED_DISTANCE * 2 + direction.x * SEED_DISTANCE),
      y: Math.round(direction.y * SEED_DISTANCE * 2),
      z: Math.round(direction.z * SEED_DISTANCE * 2),
    };
    freeSlot++;
    known.set(node.id, point);
    placed.push({ id: node.id, ...point });
  }
  return placed;
}
