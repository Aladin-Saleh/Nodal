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
  /** Seulement ce qu'un assistant IA a ajouté et que personne n'a validé. */
  assistantPendingOnly: boolean;
}

export const DEFAULT_FILTERS: GraphFilters = {
  nodeTypes: new Set(),
  tagIds: new Set(),
  hiddenRelationTypeIds: new Set(),
  showHierarchy: true,
  assistantPendingOnly: false,
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
  /** Nœuds repliés affichés → nombre de descendants masqués. */
  hiddenDescendants?: ReadonlyMap<string, number>;
  /** Nœuds retirés par l'œil (masqués, leurs descendants, hors solo). */
  maskedCount?: number;
}

/** Visibilité choisie avec l'œil de l'arborescence (affichage seulement). */
export interface GraphMasking {
  /** Nœuds masqués : retirés du graphe avec leurs descendants. */
  hidden: ReadonlySet<string>;
  /** Branche affichée seule (avec ses ancêtres, pour le contexte). */
  solo: string | null;
}

export const NO_MASKING: GraphMasking = { hidden: new Set(), solo: null };

/** Réglages d'affichage autres que les filtres. */
export interface GraphDisplay extends Partial<GraphMasking> {
  collapsed?: ReadonlySet<string>;
}

type TreeLink = Pick<GraphNode, 'id' | 'parentId'>;

function childrenMap(nodes: readonly TreeLink[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId);
    if (list) list.push(node.id);
    else children.set(node.parentId, [node.id]);
  }
  return children;
}

/** Descendants d'un nœud (lui exclu), protégé contre les cycles. */
function descendantsOf(
  children: ReadonlyMap<string, string[]>,
  id: string,
): Set<string> {
  const seen = new Set<string>([id]);
  const stack = [...(children.get(id) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    // Garde-fou contre un cycle introduit hors de l'application.
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(children.get(current) ?? []));
  }
  seen.delete(id);
  return seen;
}

/**
 * Nœuds retirés du graphe par l'œil : chaque nœud masqué et tous ses
 * descendants ; en solo, tout ce qui n'est ni la branche choisie ni l'un de
 * ses ancêtres. Un solo sur un nœud inconnu est ignoré.
 */
export function maskedNodeIds(
  nodes: readonly TreeLink[],
  masking: GraphMasking,
): Set<string> {
  const masked = new Set<string>();
  if (masking.hidden.size === 0 && !masking.solo) return masked;
  const children = childrenMap(nodes);
  const known = new Map(nodes.map((node) => [node.id, node.parentId]));
  for (const id of masking.hidden) {
    if (!known.has(id)) continue;
    masked.add(id);
    for (const descendant of descendantsOf(children, id))
      masked.add(descendant);
  }
  if (masking.solo && known.has(masking.solo)) {
    const keep = descendantsOf(children, masking.solo);
    keep.add(masking.solo);
    for (
      let parent = known.get(masking.solo) ?? null;
      parent && !keep.has(parent);
      parent = known.get(parent) ?? null
    ) {
      keep.add(parent);
    }
    for (const node of nodes) if (!keep.has(node.id)) masked.add(node.id);
  }
  return masked;
}

/**
 * Descendants masqués par le repliage : l'ensemble des nœuds cachés et, pour
 * chaque nœud replié qui a des enfants, le nombre de ses descendants.
 */
export function collapsedDescendants(
  nodes: readonly GraphNode[],
  collapsed: ReadonlySet<string>,
): { hidden: Set<string>; counts: Map<string, number> } {
  const hidden = new Set<string>();
  const counts = new Map<string, number>();
  if (collapsed.size === 0) return { hidden, counts };
  const children = childrenMap(nodes);
  for (const id of collapsed) {
    const descendants = descendantsOf(children, id);
    for (const descendant of descendants) hidden.add(descendant);
    if (descendants.size > 0) counts.set(id, descendants.size);
  }
  return { hidden, counts };
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

/**
 * Applique l'œil (masquage, solo), filtres, repliage et portée. Le nœud
 * central reste visible malgré les filtres et le repliage, mais pas s'il est
 * masqué : la portée retombe alors sur tout l'espace affiché.
 */
export function visibleGraph(
  graph: GraphData,
  scope: GraphScope,
  filters: GraphFilters,
  display: GraphDisplay = {},
): VisibleGraph {
  const centerId = scope.kind === 'neighborhood' ? scope.centerId : null;
  const masked = maskedNodeIds(graph.nodes, {
    hidden: display.hidden ?? NO_MASKING.hidden,
    solo: display.solo ?? null,
  });
  const folded = collapsedDescendants(
    graph.nodes,
    display.collapsed ?? new Set(),
  );
  const matches = (node: GraphNode) =>
    !masked.has(node.id) &&
    (node.id === centerId ||
      (!folded.hidden.has(node.id) &&
        (filters.nodeTypes.size === 0 ||
          filters.nodeTypes.has(node.nodeType)) &&
        (filters.tagIds.size === 0 ||
          node.tagIds.some((tagId) => filters.tagIds.has(tagId))) &&
        (!filters.assistantPendingOnly || !!node.assistantPending)));

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
  const hiddenDescendants = new Map(
    [...folded.counts].filter(([id]) => ids.has(id)),
  );
  return {
    nodes,
    edges,
    hierarchy,
    hiddenDescendants,
    maskedCount: masked.size,
  };
}

/**
 * Branche de chaque nœud : son ancêtre affiché le plus haut (lui-même s'il
 * n'a pas de parent affiché). La disposition regroupe chaque branche.
 */
export function branchRoots(nodes: readonly GraphNode[]): Map<string, string> {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const roots = new Map<string, string>();
  const rootOf = (id: string): string => {
    const known = roots.get(id);
    if (known) return known;
    const chain: string[] = [];
    let current = id;
    for (;;) {
      chain.push(current);
      const parent = parentOf.get(current);
      if (!parent || !parentOf.has(parent) || chain.includes(parent)) break;
      const parentRoot = roots.get(parent);
      if (parentRoot) {
        current = parentRoot;
        break;
      }
      current = parent;
    }
    for (const member of chain) roots.set(member, current);
    return current;
  };
  for (const node of nodes) rootOf(node.id);
  return roots;
}

/** Étiquette candidate, en pixels : ancrée par son coin haut-gauche. */
export interface LabelBox {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Toujours affichée (sélection, survol), même si elle en chevauche une autre. */
  forced: boolean;
  /**
   * Emprise d'un nœud à l'écran : aucune étiquette ne la recouvre, sauf la
   * sienne et celles de nœuds plus importants que lui.
   */
  obstacle?: boolean;
  /** Importance du nœud (enfants, relations) : voir obstacle. */
  rank?: number;
  /** Nœud auquel appartient l'étiquette ou l'emprise. */
  owner?: string;
}

/** Espace minimal entre deux étiquettes, en pixels. */
export const LABEL_GAP_PX = 3;

/**
 * Étiquettes à afficher sans chevauchement : parcourues dans l'ordre donné
 * (la plus prioritaire d'abord), chacune est gardée si elle ne recouvre ni
 * une étiquette déjà gardée, ni l'emprise d'un autre nœud au moins aussi
 * important (un parent peut nommer sa branche par-dessus ses feuilles). Les étiquettes
 * forcées passent en premier et sont toujours gardées.
 */
export function declutterLabels(boxes: readonly LabelBox[]): Set<string> {
  const kept: LabelBox[] = boxes.filter((box) => box.obstacle);
  const labels = boxes.filter((box) => !box.obstacle);
  const ordered = [
    ...labels.filter((box) => box.forced),
    ...labels.filter((box) => !box.forced),
  ];
  const overlaps = (a: LabelBox, b: LabelBox) =>
    !(b.obstacle && (b.owner === a.owner || (b.rank ?? 0) < (a.rank ?? 0))) &&
    a.left < b.left + b.width + LABEL_GAP_PX &&
    b.left < a.left + a.width + LABEL_GAP_PX &&
    a.top < b.top + b.height + LABEL_GAP_PX &&
    b.top < a.top + a.height + LABEL_GAP_PX;
  const shown = new Set<string>();
  for (const box of ordered) {
    if (box.forced || !kept.some((other) => overlaps(box, other))) {
      kept.push(box);
      shown.add(box.id);
    }
  }
  return shown;
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
