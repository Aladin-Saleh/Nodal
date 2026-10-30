import { describe, expect, it } from 'vitest';
import {
  branchRoots,
  collapsedDescendants,
  declutterLabels,
  DEFAULT_FILTERS,
  hasPosition,
  LABEL_GAP_PX,
  maskedNodeIds,
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

describe('repliage', () => {
  // r → m → (l1, l2), r → s ; l2 relié à e (hors branche)
  const tree: GraphData = {
    ...graph,
    nodes: [
      node('r'),
      node('m', { parentId: 'r' }),
      node('l1', { parentId: 'm' }),
      node('l2', { parentId: 'm' }),
      node('s', { parentId: 'r' }),
      node('e'),
    ],
    edges: [edge('l2e', 'l2', 'e')],
  };

  it('compte et masque tous les descendants d’un nœud replié', () => {
    const { hidden, counts } = collapsedDescendants(
      tree.nodes,
      new Set(['m', 'l1']),
    );
    expect([...hidden].toSorted()).toEqual(['l1', 'l2']);
    // l1 n'a pas d'enfant : rien à compter.
    expect(counts).toEqual(new Map([['m', 2]]));
  });

  it('retire les descendants et leurs relations du graphe affiché', () => {
    const visible = visibleGraph(tree, { kind: 'all' }, DEFAULT_FILTERS, {
      collapsed: new Set(['r']),
    });
    expect(ids(visible.nodes)).toEqual(['e', 'r']);
    expect(visible.edges).toEqual([]);
    expect(visible.hierarchy).toEqual([]);
    expect(visible.hiddenDescendants).toEqual(new Map([['r', 4]]));
  });

  it('ne signale que les nœuds repliés encore affichés', () => {
    const visible = visibleGraph(tree, { kind: 'all' }, DEFAULT_FILTERS, {
      collapsed: new Set(['r', 'm']),
    });
    expect(visible.hiddenDescendants).toEqual(new Map([['r', 4]]));
  });

  it('garde le nœud central du voisinage même s’il est replié dans une branche', () => {
    const visible = visibleGraph(
      tree,
      { kind: 'neighborhood', centerId: 'l2', depth: 1 },
      DEFAULT_FILTERS,
      { collapsed: new Set(['m']) },
    );
    // m, son parent, est replié mais reste affiché (seuls ses descendants sont masqués).
    expect(ids(visible.nodes)).toEqual(['e', 'l2', 'm']);
  });
});

describe('branchRoots', () => {
  it('rattache chaque nœud à son ancêtre affiché le plus haut', () => {
    const roots = branchRoots([
      node('r'),
      node('m', { parentId: 'r' }),
      node('l', { parentId: 'm' }),
      // Parent non affiché : le nœud est sa propre racine.
      node('o', { parentId: 'absent' }),
      node('p', { parentId: 'o' }),
    ]);
    expect(Object.fromEntries(roots)).toEqual({
      r: 'r',
      m: 'r',
      l: 'r',
      o: 'o',
      p: 'o',
    });
  });

  it('ne boucle pas sur un cycle', () => {
    const roots = branchRoots([
      node('x', { parentId: 'y' }),
      node('y', { parentId: 'x' }),
    ]);
    expect(roots.size).toBe(2);
  });
});

const box = (id: string, left: number, top: number, forced = false) => ({
  id,
  left,
  top,
  width: 100,
  height: 20,
  forced,
});

describe('declutterLabels', () => {
  it('garde les étiquettes prioritaires et écarte celles qui les chevauchent', () => {
    const kept = declutterLabels([
      box('a', 0, 0),
      box('b', 50, 10), // chevauche a
      box('c', 0, 30), // en dessous, libre
      box('d', 200, 0),
    ]);
    expect([...kept].toSorted()).toEqual(['a', 'c', 'd']);
  });

  it('affiche toujours les étiquettes forcées, en premier', () => {
    const kept = declutterLabels([box('a', 0, 0), box('hover', 50, 10, true)]);
    expect([...kept]).toEqual(['hover']);
  });

  it('laisse un espace minimal entre deux étiquettes', () => {
    const kept = declutterLabels([
      box('a', 0, 0),
      box('b', 100 + LABEL_GAP_PX - 1, 0),
      box('c', 0, 20 + LABEL_GAP_PX),
    ]);
    expect([...kept].toSorted()).toEqual(['a', 'c']);
  });
});

describe('declutterLabels et emprise des nœuds', () => {
  it('écarte une étiquette posée sur un autre nœud, pas sur le sien', () => {
    const footprint = (owner: string, left: number, top: number) => ({
      ...box(`o:${owner}`, left, top),
      width: 20,
      obstacle: true,
      owner,
    });
    const kept = declutterLabels([
      footprint('a', 40, 30),
      footprint('b', 240, 30),
      { ...box('n:a', 0, 20), owner: 'a' }, // sur son propre nœud
      { ...box('n:c', 200, 20), owner: 'c' }, // sur le nœud b
    ]);
    expect([...kept]).toEqual(['n:a']);
  });
});

describe('declutterLabels et importance', () => {
  it('laisse un nœud important nommer sa branche par-dessus ses feuilles', () => {
    const kept = declutterLabels([
      {
        ...box('o:leaf', 40, 30),
        width: 20,
        obstacle: true,
        owner: 'leaf',
        rank: 1,
      },
      { ...box('n:root', 0, 20), owner: 'root', rank: 5 },
      { ...box('n:other', 0, 200), owner: 'other', rank: 0 },
      {
        ...box('o:hub', 40, 210),
        width: 20,
        obstacle: true,
        owner: 'hub',
        rank: 3,
      },
    ]);
    expect([...kept]).toEqual(['n:root']);
  });
});

const masking = (hidden: string[], solo: string | null = null) => ({
  hidden: new Set(hidden),
  solo,
});

describe('œil : masquage et solo', () => {
  // r → m → (l1, l2), r → s ; autre racine o ; relations l2→o, s→l1
  const tree: GraphData = {
    ...graph,
    nodes: [
      node('r'),
      node('m', { parentId: 'r' }),
      node('l1', { parentId: 'm' }),
      node('l2', { parentId: 'm', nodeType: 'data' }),
      node('s', { parentId: 'r' }),
      node('o'),
    ],
    edges: [edge('l2o', 'l2', 'o'), edge('sl1', 's', 'l1')],
  };

  it('masque un nœud, tous ses descendants et leurs relations', () => {
    expect([...maskedNodeIds(tree.nodes, masking(['m']))].toSorted()).toEqual([
      'l1',
      'l2',
      'm',
    ]);
    const visible = visibleGraph(
      tree,
      { kind: 'all' },
      DEFAULT_FILTERS,
      masking(['m']),
    );
    expect(ids(visible.nodes)).toEqual(['o', 'r', 's']);
    expect(visible.edges).toEqual([]);
    expect(visible.maskedCount).toBe(3);
  });

  it('diffère du repli : le nœud masqué disparaît, le nœud replié reste', () => {
    const collapsed = visibleGraph(tree, { kind: 'all' }, DEFAULT_FILTERS, {
      collapsed: new Set(['m']),
    });
    expect(ids(collapsed.nodes)).toContain('m');
    expect(collapsed.maskedCount).toBe(0);
  });

  it('en solo, ne garde que la branche et ses ancêtres', () => {
    expect([...maskedNodeIds(tree.nodes, masking([], 'm'))].toSorted()).toEqual(
      ['o', 's'],
    );
    // Un masquage dans la branche solo s'applique toujours.
    expect(
      [...maskedNodeIds(tree.nodes, masking(['l1'], 'm'))].toSorted(),
    ).toEqual(['l1', 'o', 's']);
  });

  it('ignore un solo ou un masquage sur un nœud inconnu', () => {
    expect(maskedNodeIds(tree.nodes, masking(['absent'], 'absent')).size).toBe(
      0,
    );
  });

  it('se combine avec les filtres et les replis', () => {
    const visible = visibleGraph(
      tree,
      { kind: 'all' },
      filters({ nodeTypes: new Set(['concept']) }),
      { collapsed: new Set(['r']), hidden: new Set(['o']) },
    );
    expect(ids(visible.nodes)).toEqual(['r']);
    expect(visible.hiddenDescendants).toEqual(new Map([['r', 4]]));
  });

  it('ne garde pas un nœud central masqué : la portée retombe sur l’espace affiché', () => {
    const visible = visibleGraph(
      tree,
      { kind: 'neighborhood', centerId: 'l2', depth: 1 },
      DEFAULT_FILTERS,
      masking(['m']),
    );
    expect(ids(visible.nodes)).toEqual(['o', 'r', 's']);
  });

  it('limite le voisinage d’un nœud visible aux nœuds non masqués', () => {
    const visible = visibleGraph(
      tree,
      { kind: 'neighborhood', centerId: 's', depth: 2 },
      DEFAULT_FILTERS,
      masking(['l1']),
    );
    // s → r (parent) → m (enfant de r) ; l1 est masqué malgré la relation s→l1.
    expect(ids(visible.nodes)).toEqual(['m', 'r', 's']);
  });
});
