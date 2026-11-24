import { describe, expect, it } from 'vitest';
import { impactDirection, impactOf } from '../../src/shared/graph-impact';

const node = (id: string, parentId: string | null = null) => ({ id, parentId });
const edge = (sourceId: string, relationTypeId: string, targetId: string) => ({
  id: `${sourceId}-${targetId}`,
  sourceId,
  targetId,
  relationTypeId,
});
const ids = (hits: ReturnType<typeof impactOf>) =>
  hits.map((hit) => `${hit.nodeId}:${hit.depth}`);

describe('impact d’un changement', () => {
  const nodes = ['db', 'api', 'ui', 'doc', 'vague'].map((id) => node(id));
  const edges = [
    edge('api', 'dépend de', 'db'),
    edge('ui', 'utilise', 'api'),
    edge('db', 'alimente', 'doc'),
    edge('vague', 'est lié à', 'db'),
  ];

  it('remonte les relations dans le sens de la dépendance', () => {
    expect(ids(impactOf(nodes, edges, ['db'], impactDirection))).toEqual([
      'api:1',
      'doc:1',
      'ui:2',
    ]);
    expect(ids(impactOf(nodes, edges, ['db'], impactDirection, 1))).toEqual([
      'api:1',
      'doc:1',
    ]);
    expect(impactOf(nodes, edges, ['ui'], impactDirection)).toEqual([]);
  });

  it('ne suit un type inconnu que si on en donne le sens', () => {
    const custom = [edge('a', 'appelle', 'b')];
    const pair = [node('a'), node('b')];
    expect(impactDirection('Dépend de')).toBe('source');
    expect(impactOf(pair, custom, ['b'], impactDirection)).toEqual([]);
    expect(ids(impactOf(pair, custom, ['b'], () => 'source'))).toEqual(['a:1']);
  });

  it('part aussi des sous-nœuds, sans les lister ni boucler', () => {
    const tree = [node('p'), node('c', 'p'), node('x')];
    const loop = [edge('x', 'utilise', 'c'), edge('c', 'utilise', 'x')];
    expect(ids(impactOf(tree, loop, ['p'], impactDirection))).toEqual(['x:1']);
  });
});
