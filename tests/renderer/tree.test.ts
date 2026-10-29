import { describe, expect, it } from 'vitest';
import {
  ancestorIds,
  buildTreeIndex,
  subtreeIds,
  visibleRows,
} from '../../src/renderer/features/nodes/tree';
import type { NodeSummary } from '../../src/shared/model';

const node = (
  id: string,
  parentId: string | null,
  sortOrder: number,
): NodeSummary => ({
  id,
  parentId,
  title: id.toUpperCase(),
  nodeType: 'concept',
  color: null,
  sortOrder,
});

const index = buildTreeIndex([
  node('b', null, 1),
  node('a', null, 0),
  node('a2', 'a', 1),
  node('a1', 'a', 0),
  node('a1x', 'a1', 0),
]);

describe('tree', () => {
  it('ne montre que les racines quand rien n’est déplié', () => {
    expect(visibleRows(index, new Set()).map((row) => row.node.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('déplie dans l’ordre avec la profondeur', () => {
    const rows = visibleRows(index, new Set(['a', 'a1']));
    expect(
      rows.map((row) => [row.node.id, row.depth, row.hasChildren]),
    ).toEqual([
      ['a', 0, true],
      ['a1', 1, true],
      ['a1x', 2, false],
      ['a2', 1, false],
      ['b', 0, false],
    ]);
  });

  it('calcule le sous-arbre et les ancêtres', () => {
    expect([...subtreeIds(index, 'a')].toSorted()).toEqual([
      'a',
      'a1',
      'a1x',
      'a2',
    ]);
    expect(ancestorIds(index, 'a1x')).toEqual(['a1', 'a']);
    expect(ancestorIds(index, 'b')).toEqual([]);
  });

  it('affiche à la racine un nœud dont le parent est inconnu', () => {
    const orphan = buildTreeIndex([node('x', 'inconnu', 0)]);
    expect(visibleRows(orphan, new Set()).map((row) => row.node.id)).toEqual([
      'x',
    ]);
  });
});
