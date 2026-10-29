/**
 * Logique pure de la vue graphe : portée (espace entier ou voisinage),
 * filtres, placement des nœuds sans position et éléments Cytoscape.
 */
import type { NodeType } from '../../../shared/domain';
import type {
  EdgeInfo,
  GraphData,
  GraphNode,
  NodePosition,
  RelationTypeInfo,
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

const PLACEMENT_GAP = 160;

/**
 * Donne une position aux nœuds qui n'en ont pas, à côté d'un voisin déjà
 * placé (parent, puis extrémité d'une relation), sinon à droite de
 * l'ensemble. Retourne uniquement les positions nouvellement calculées.
 * Si aucun nœud visible n'a de position, retourne une liste vide : il faut
 * alors une disposition automatique complète.
 */
export function placeMissing(visible: VisibleGraph): NodePosition[] {
  const known = new Map<string, { x: number; y: number }>();
  for (const node of visible.nodes) {
    if (node.x !== null && node.y !== null)
      known.set(node.id, { x: node.x, y: node.y });
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

  const maxX = Math.max(...[...known.values()].map((point) => point.x));
  const minY = Math.min(...[...known.values()].map((point) => point.y));
  const childrenPlaced = new Map<string, number>();
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
      const rank = childrenPlaced.get(anchorId) ?? 0;
      childrenPlaced.set(anchorId, rank + 1);
      const angle = (rank * 2 * Math.PI) / 6 + Math.PI / 2;
      const ring = 1 + Math.floor(rank / 6);
      const point = {
        x: Math.round(anchor.x + Math.cos(angle) * PLACEMENT_GAP * ring),
        y: Math.round(anchor.y + Math.sin(angle) * PLACEMENT_GAP * ring),
      };
      known.set(node.id, point);
      placed.push({ id: node.id, ...point });
    }
    pending = remaining;
  }
  for (const node of pending) {
    const point = {
      x: Math.round(maxX + PLACEMENT_GAP * (1 + Math.floor(freeSlot / 5))),
      y: Math.round(minY + (freeSlot % 5) * (PLACEMENT_GAP / 2)),
    };
    freeSlot++;
    known.set(node.id, point);
    placed.push({ id: node.id, ...point });
  }
  return placed;
}

/** Largeur et hauteur approximatives d'un nœud selon son titre. */
export function nodeSize(title: string): { width: number; height: number } {
  const charWidth = 7.8;
  const maxTextWidth = 190;
  const textWidth = Math.min(title.length * charWidth, maxTextWidth);
  const lines = Math.min(
    3,
    Math.max(1, Math.ceil((title.length * charWidth) / maxTextWidth)),
  );
  return {
    width: Math.max(90, Math.round(textWidth + 32)),
    height: 26 + lines * 17,
  };
}

export interface ElementDefinition {
  group: 'nodes' | 'edges';
  data: Record<string, unknown> & { id: string };
  position?: { x: number; y: number };
  classes?: string;
}

/** Éléments Cytoscape. Les nœuds sans position n'en reçoivent pas. */
export function toElements(
  visible: VisibleGraph,
  relationTypes: readonly RelationTypeInfo[],
): ElementDefinition[] {
  const typeById = new Map(relationTypes.map((type) => [type.id, type]));
  const nodes: ElementDefinition[] = visible.nodes.map((node) => {
    const size = nodeSize(node.title);
    return {
      group: 'nodes',
      data: {
        id: node.id,
        label: node.title,
        nodeType: node.nodeType,
        ...(node.color ? { color: node.color } : {}),
        width: size.width,
        height: size.height,
      },
      ...(node.x !== null && node.y !== null
        ? { position: { x: node.x, y: node.y } }
        : {}),
      classes: `type-${node.nodeType}${node.color ? ' custom-color' : ''}`,
    };
  });
  const edges: ElementDefinition[] = visible.edges.map((edge) => {
    const type = typeById.get(edge.relationTypeId);
    return {
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        label: edge.label ?? type?.name ?? '',
        ...(type?.color ? { color: type.color } : {}),
      },
      classes: type?.color ? 'relation custom-color' : 'relation',
    };
  });
  const hierarchy: ElementDefinition[] = visible.hierarchy.map((link) => ({
    group: 'edges',
    data: { id: link.id, source: link.parentId, target: link.childId },
    classes: 'hierarchy',
  }));
  return [...nodes, ...edges, ...hierarchy];
}
