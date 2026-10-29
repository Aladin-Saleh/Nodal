import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS,
  hasPosition,
  SEED_DISTANCE,
  seedPositions,
  visibleGraph,
  type GraphFilters,
} from '../../src/renderer/features/graph/graph-model';
import type { NodeType } from '../../src/shared/domain';
import type { EdgeInfo, GraphData, GraphNode } from '../../src/shared/model';

const node = (
  id: string,
  options: Partial<GraphNode> & { nodeType?: NodeType } = {},
): GraphNode => ({
  id,
  parentId: null,
  title: id.toUpperCase(),
  nodeType: 'concept',
  color: null,
  x: null,
  y: null,
  z: null,
  tagIds: [],
  ...options,
});

const edge = (
  id: string,
  sourceId: string,
  targetId: string,
  relationTypeId = 'uses',
): EdgeInfo => ({
  id,
  sourceId,
  targetId,
  relationTypeId,
  label: null,
  description: null,
  createdAt: '',
  updatedAt: '',
});

// a → b → c → d, e isolé, f enfant de a
const graph: GraphData = {
  nodes: [
    node('a'),
    node('b', { nodeType: 'data', tagIds: ['t1'] }),
    node('c'),
    node('d'),
    node('e', { nodeType: 'data' }),
    node('f', { parentId: 'a' }),
  ],
  edges: [
    edge('ab', 'a', 'b'),
    edge('bc', 'b', 'c', 'feeds'),
    edge('cd', 'c', 'd'),
  ],
  relationTypes: [
    {
      id: 'uses',
      name: 'utilise',
      color: null,
      isBuiltin: true,
      usageCount: 2,
    },
    {
      id: 'feeds',
      name: 'alimente',
      color: '#ff0000',
      isBuiltin: true,
      usageCount: 1,
    },
  ],
};

const ids = (items: { id: string }[]) =>
  items.map((item) => item.id).toSorted();
const filters = (overrides: Partial<GraphFilters>): GraphFilters => ({
  ...DEFAULT_FILTERS,
  ...overrides,
});

describe('visibleGraph', () => {
  it('affiche tout l’espace avec la hiérarchie', () => {
    const visible = visibleGraph(graph, { kind: 'all' }, DEFAULT_FILTERS);
    expect(ids(visible.nodes)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(ids(visible.edges)).toEqual(['ab', 'bc', 'cd']);
    expect(visible.hierarchy).toEqual([
      { id: 'hierarchy:f', parentId: 'a', childId: 'f' },
    ]);
  });

  it('limite au voisinage à N niveaux, dans les deux sens', () => {
    const scope = { kind: 'neighborhood', centerId: 'c', depth: 1 } as const;
    const noHierarchy = filters({ showHierarchy: false });
    expect(ids(visibleGraph(graph, scope, noHierarchy).nodes)).toEqual([
      'b',
      'c',
      'd',
    ]);
    expect(
      ids(visibleGraph(graph, { ...scope, depth: 2 }, noHierarchy).nodes),
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('suit la hiérarchie dans le voisinage si elle est affichée', () => {
    const scope = { kind: 'neighborhood', centerId: 'a', depth: 1 } as const;
    expect(ids(visibleGraph(graph, scope, DEFAULT_FILTERS).nodes)).toEqual([
      'a',
      'b',
      'f',
    ]);
    expect(
      ids(visibleGraph(graph, scope, filters({ showHierarchy: false })).nodes),
    ).toEqual(['a', 'b']);
  });

  it('filtre par type de nœud et par tag, en gardant le nœud central', () => {
    expect(
      ids(
        visibleGraph(
          graph,
          { kind: 'all' },
          filters({ nodeTypes: new Set(['data']) }),
        ).nodes,
      ),
    ).toEqual(['b', 'e']);
    expect(
      ids(
        visibleGraph(
          graph,
          { kind: 'all' },
          filters({ tagIds: new Set(['t1']) }),
        ).nodes,
      ),
    ).toEqual(['b']);
    const centered = visibleGraph(
      graph,
      { kind: 'neighborhood', centerId: 'a', depth: 1 },
      filters({ nodeTypes: new Set(['data']), showHierarchy: false }),
    );
    expect(ids(centered.nodes)).toEqual(['a', 'b']);
  });

  it('masque un type de relation, ce qui coupe aussi le voisinage', () => {
    const hidden = filters({
      hiddenRelationTypeIds: new Set(['feeds']),
      showHierarchy: false,
    });
    expect(ids(visibleGraph(graph, { kind: 'all' }, hidden).edges)).toEqual([
      'ab',
      'cd',
    ]);
    expect(
      ids(
        visibleGraph(
          graph,
          { kind: 'neighborhood', centerId: 'a', depth: 3 },
          hidden,
        ).nodes,
      ),
    ).toEqual(['a', 'b']);
  });
});

describe('seedPositions', () => {
  it('ne propose rien si aucun nœud n’est placé (disposition complète requise)', () => {
    expect(
      seedPositions(visibleGraph(graph, { kind: 'all' }, DEFAULT_FILTERS)),
    ).toEqual([]);
  });

  it('ignore une ancienne position 2D sans coordonnée z', () => {
    expect(hasPosition(node('x', { x: 1, y: 2 }))).toBe(false);
    expect(hasPosition(node('x', { x: 1, y: 2, z: 3 }))).toBe(true);
  });

  it('fait apparaître un nouveau nœud près de son parent ou d’un voisin', () => {
    const positioned: GraphData = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === 'a'
          ? { ...n, x: 0, y: 0, z: 0 }
          : n.id === 'c'
            ? { ...n, x: 500, y: 500, z: 500 }
            : n,
      ),
    };
    const seeds = seedPositions(
      visibleGraph(positioned, { kind: 'all' }, DEFAULT_FILTERS),
    );
    const byId = new Map(seeds.map((seed) => [seed.id, seed]));
    expect([...byId.keys()].toSorted()).toEqual(['b', 'd', 'e', 'f']);
    const distance = (id: string, x: number, y: number, z: number) => {
      const p = byId.get(id)!;
      return Math.hypot(p.x - x, p.y - y, p.z - z);
    };
    expect(distance('f', 0, 0, 0)).toBeLessThanOrEqual(SEED_DISTANCE + 1);
    expect(distance('d', 500, 500, 500)).toBeLessThanOrEqual(SEED_DISTANCE + 1);
    // Nœud isolé : placé à côté de l'ensemble.
    expect(byId.get('e')!.x).toBeGreaterThan(500);
  });

  it('répartit plusieurs enfants d’un même parent sans les superposer', () => {
    const children = Array.from({ length: 8 }, (_, i) =>
      node(`k${i}`, { parentId: 'p' }),
    );
    const seeds = seedPositions({
      nodes: [node('p', { x: 0, y: 0, z: 0 }), ...children],
      edges: [],
      hierarchy: [],
    });
    const keys = new Set(seeds.map((seed) => `${seed.x},${seed.y},${seed.z}`));
    expect(keys.size).toBe(8);
  });
});
