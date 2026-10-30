import { describe, expect, it } from 'vitest';
import {
  ancestorIds,
  buildTreeIndex,
  dropMove,
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

describe('dropMove', () => {
  // Racines : a (a1 → a1x, a2), b.
  it('dépose dans un nœud : en dernier enfant', () => {
    expect(dropMove(index, 'b', 'a1', 'inside')).toEqual({ parentId: 'a1' });
  });

  it('dépose avant ou après un frère, nœud déplacé exclu du rang', () => {
    expect(dropMove(index, 'b', 'a2', 'before')).toEqual({
      parentId: 'a',
      index: 1,
    });
    // a1 après a2, chez le même parent : a2 est alors au rang 0.
    expect(dropMove(index, 'a1', 'a2', 'after')).toEqual({
      parentId: 'a',
      index: 1,
    });
    expect(dropMove(index, 'a1x', 'b', 'before')).toEqual({
      parentId: null,
      index: 1,
    });
  });

  it('refuse un dépôt sur soi-même ou dans un descendant (cycle)', () => {
    expect(dropMove(index, 'a', 'a', 'inside')).toBeNull();
    expect(dropMove(index, 'a', 'a1x', 'inside')).toBeNull();
    expect(dropMove(index, 'a', 'a2', 'after')).toBeNull();
  });

  it('ignore un dépôt qui ne changerait rien', () => {
    expect(dropMove(index, 'a1', 'a', 'inside')).toBeNull();
    expect(dropMove(index, 'a1', 'a2', 'before')).toBeNull();
    expect(dropMove(index, 'a2', 'a1', 'after')).toBeNull();
  });
});
