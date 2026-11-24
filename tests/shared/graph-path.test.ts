import { describe, expect, it } from 'vitest';
import {
  findShortestPath,
  hierarchyLinkId,
  pathLinkIds,
  shortestPath,
  type PathGraphEdge,
  type PathGraphNode,
} from '../../src/shared/graph-path';

//   root ─┬─ a ── a1
//         └─ b
// relations : a1 →(uses) c, c →(feeds) b, d isolé
const nodes: PathGraphNode[] = [
  { id: 'root', parentId: null },
  { id: 'a', parentId: 'root' },
  { id: 'a1', parentId: 'a' },
  { id: 'b', parentId: 'root' },
  { id: 'c', parentId: null },
  { id: 'd', parentId: null },
];
const edges: PathGraphEdge[] = [
  { id: 'e1', sourceId: 'a1', targetId: 'c', relationTypeId: 'uses' },
  { id: 'e2', sourceId: 'c', targetId: 'b', relationTypeId: 'feeds' },
];
const relationsOnly = { includeHierarchy: false, maxDepth: 6 };
const withHierarchy = { includeHierarchy: true, maxDepth: 6 };

describe('plus court chemin', () => {
  it('suit les relations dans les deux sens', () => {
    expect(shortestPath(nodes, edges, 'b', 'a1', relationsOnly)).toEqual([
      { nodeId: 'b', via: null },
      {
        nodeId: 'c',
        via: {
          kind: 'relation',
          edgeId: 'e2',
          relationTypeId: 'feeds',
          forward: false,
        },
      },
      {
        nodeId: 'a1',
        via: {
          kind: 'relation',
          edgeId: 'e1',
          relationTypeId: 'uses',
          forward: false,
        },
      },
    ]);
  });

  it('passe par la hiérarchie seulement si demandé, et prend le plus court', () => {
    expect(shortestPath(nodes, edges, 'a', 'b', relationsOnly)).toBeNull();
    const steps = shortestPath(nodes, edges, 'a', 'b', withHierarchy)!;
    // a ↑ root ↓ b (2 liens) plutôt que a ↓ a1 → c → b (3 liens).
    expect(steps.map((step) => step.nodeId)).toEqual(['a', 'root', 'b']);
    expect(steps.map((step) => step.via?.kind ?? null)).toEqual([
      null,
      'parent',
      'child',
    ]);
    expect(pathLinkIds(steps)).toEqual([
      hierarchyLinkId('a'),
      hierarchyLinkId('b'),
    ]);
  });

  it('respecte la profondeur maximale', () => {
    expect(
      shortestPath(nodes, edges, 'b', 'a1', { ...relationsOnly, maxDepth: 1 }),
    ).toBeNull();
    expect(
      shortestPath(nodes, edges, 'b', 'a1', { ...relationsOnly, maxDepth: 2 }),
    ).toHaveLength(3);
  });

  it('cas limites : même nœud, nœud isolé ou inconnu', () => {
    expect(shortestPath(nodes, edges, 'a', 'a', relationsOnly)).toEqual([
      { nodeId: 'a', via: null },
    ]);
    expect(shortestPath(nodes, edges, 'a', 'd', withHierarchy)).toBeNull();
    expect(
      shortestPath(nodes, edges, 'a', 'inconnu', withHierarchy),
    ).toBeNull();
  });

  it('ignore une relation vers un nœud absent', () => {
    const dangling = [
      ...edges,
      { id: 'e3', sourceId: 'd', targetId: 'fantôme', relationTypeId: 'uses' },
    ];
    expect(shortestPath(nodes, dangling, 'd', 'c', relationsOnly)).toBeNull();
  });

  it('identifiants de liens pour le graphe : relations et hiérarchie', () => {
    const steps = shortestPath(nodes, edges, 'root', 'c', withHierarchy)!;
    // root ↓ b ← c (2 liens) : b est l'enfant du lien hiérarchique.
    expect(steps.map((step) => step.nodeId)).toEqual(['root', 'b', 'c']);
    expect(pathLinkIds(steps)).toEqual([hierarchyLinkId('b'), 'e2']);
  });
});

const link = (sourceId: string, type: string, targetId: string) => ({
  id: `${sourceId}${targetId}${type}`,
  sourceId,
  targetId,
  relationTypeId: type,
});

describe('chemins aussi courts', () => {
  const flat = ['a', 'b', 'v', 'h', 'p', 'x', 'y'].map((id) => ({
    id,
    parentId: null,
  }));
  const via = (list: PathGraphEdge[], options = {}) => {
    const found = findShortestPath(flat, list, 'a', 'b', {
      ...relationsOnly,
      vagueTypes: new Set(['vague']),
      ...options,
    });
    return found && [found.steps[1]!.nodeId, found.routes];
  };
  const vague = [link('a', 'vague', 'v'), link('v', 'vague', 'b')];
  const hub = [
    link('a', 'uses', 'h'),
    link('h', 'uses', 'b'),
    link('h', 'uses', 'x'),
    link('h', 'uses', 'y'),
  ];
  const precise = [link('a', 'uses', 'p'), link('p', 'uses', 'b')];

  it('évite les liens vagues, puis les nœuds reliés à tout', () => {
    expect(via([...vague, ...hub])).toEqual(['h', 2]);
    expect(via([...vague, ...hub, ...precise])).toEqual(['p', 3]);
    // L'ordre des données ne décide qu'à défaut.
    expect(via([...precise, ...hub, ...vague])).toEqual(['p', 3]);
  });

  it('compte les chemins par nœuds, pas par relations parallèles', () => {
    expect(via([...precise, link('p', 'feeds', 'b')])).toEqual(['p', 1]);
  });

  it('garde la relation la plus précise entre deux nœuds', () => {
    const steps = shortestPath(
      flat,
      [link('a', 'vague', 'b'), link('a', 'uses', 'b')],
      'a',
      'b',
      { ...relationsOnly, vagueTypes: new Set(['vague']) },
    )!;
    expect(steps[1]!.via).toMatchObject({ relationTypeId: 'uses' });
  });

  it('suit le sens des relations si demandé', () => {
    const back = [link('b', 'uses', 'p'), link('p', 'uses', 'a')];
    expect(via(back)).toEqual(['p', 1]);
    expect(via(back, { directed: true })).toBeNull();
  });
});
