import { describe, expect, it } from 'vitest';
import {
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
