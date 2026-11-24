import { describe, expect, it } from 'vitest';
import {
  bridges,
  connections,
  dependencyCycles,
  redundantRelations,
  suggestedQuestions,
  type AnalysisEdge,
  type AnalysisNode,
} from '../../src/shared/graph-analysis';

const node = (id: string, parentId: string | null = null): AnalysisNode => ({
  id,
  title: id.toUpperCase(),
  type: 'concept',
  parentId,
});
const edge = (
  sourceId: string,
  relation: string,
  targetId: string,
  extra: Partial<AnalysisEdge> = {},
): AnalysisEdge => ({
  id: `${sourceId}-${relation}-${targetId}`,
  sourceId,
  targetId,
  relation,
  detailed: false,
  fromLink: false,
  pending: false,
  ...extra,
});
const letters = (text: string) => text.split('').map((id) => node(id));

const reasons = (nodes: AnalysisNode[], edges: AnalysisEdge[]) =>
  redundantRelations({ nodes, edges }).map(({ edge: item, reason }) => [
    item.id,
    reason,
  ]);

describe('relations superflues', () => {
  it('lien vague en plus d’une relation précise, ou en double', () => {
    expect(
      reasons(letters('abc'), [
        edge('a', 'est lié à', 'b'),
        edge('b', 'utilise', 'a'),
        edge('b', 'est lié à', 'c'),
        edge('c', 'est lié à', 'b'),
      ]),
    ).toEqual([
      ['a-est lié à-b', 'duplicate'],
      ['c-est lié à-b', 'duplicate'],
    ]);
  });

  it('lien vague entre parent et enfant', () => {
    expect(
      reasons([node('a'), node('b', 'a')], [edge('b', 'est lié à', 'a')]),
    ).toEqual([['b-est lié à-a', 'hierarchy']]);
  });

  it('« dépend de » impliqué par une chaîne, pas les autres types', () => {
    const chain = [edge('a', 'dépend de', 'b'), edge('b', 'dépend de', 'c')];
    const found = redundantRelations({
      nodes: letters('abc'),
      edges: [...chain, edge('a', 'dépend de', 'c')],
    });
    expect(found).toMatchObject([{ reason: 'implied', through: ['b'] }]);
    expect(
      reasons(letters('abc'), [...chain, edge('a', 'utilise', 'c')]),
    ).toEqual([]);
  });

  it('jamais une relation libellée ou issue d’un lien', () => {
    expect(
      reasons(letters('ab'), [
        edge('a', 'utilise', 'b'),
        edge('a', 'est lié à', 'b', { detailed: true }),
        edge('b', 'est lié à', 'a', { fromLink: true }),
      ]),
    ).toEqual([]);
  });
});

describe('cycles de dépendance', () => {
  it('trouve chaque cycle une fois, le plus court d’abord', () => {
    const cycles = dependencyCycles({
      nodes: letters('abcde'),
      edges: [
        edge('a', 'dépend de', 'b'),
        edge('b', 'utilise', 'c'),
        edge('c', 'utilise', 'a'),
        // « E alimente D » : D dépend de E.
        edge('d', 'dépend de', 'e'),
        edge('d', 'alimente', 'e'),
      ],
    });
    expect(cycles.map((cycle) => cycle.toSorted().join(''))).toEqual([
      'de',
      'abc',
    ]);
  });

  it('un lien vague ou une description ne font pas un cycle', () => {
    expect(
      dependencyCycles({
        nodes: letters('ab'),
        edges: [
          edge('a', 'dépend de', 'b'),
          edge('b', 'est lié à', 'a'),
          edge('b', 'décrit', 'a'),
        ],
      }),
    ).toEqual([]);
  });
});

describe('charnières et connexions', () => {
  it('le nœud par lequel tout passe', () => {
    const star = ['b', 'c', 'd'].map((id) => edge(id, 'utilise', 'a'));
    expect(bridges({ nodes: letters('abcd'), edges: star })).toEqual([
      { nodeId: 'a', score: 1 },
    ]);
    // Chaîne a-b-c-d : b et c portent chacun 4 des 6 trajets.
    const line = [
      edge('a', 'utilise', 'b'),
      edge('b', 'utilise', 'c'),
      edge('c', 'utilise', 'd'),
    ];
    const scores = bridges({ nodes: letters('abcd'), edges: line });
    expect(scores.map(({ nodeId }) => nodeId).toSorted()).toEqual(['b', 'c']);
    expect(scores[0]!.score).toBeCloseTo(4 / 6);
  });

  it('une connexion par paire de branches, ni entre frères ni dans une branche', () => {
    const nodes = [
      node('r'),
      node('x', 'r'),
      node('x1', 'x'),
      node('x2', 'x'),
      node('y', 'r'),
      node('y1', 'y'),
    ];
    const found = connections({
      nodes,
      edges: [
        edge('x1', 'utilise', 'x2'),
        edge('x1', 'utilise', 'r'),
        edge('x1', 'utilise', 'y1'),
        edge('x2', 'utilise', 'y1', { pending: true }),
      ],
    });
    expect(found.map((item) => item.edge.id)).toEqual(['x2-utilise-y1']);
    expect(found[0]!.reasons).toContain('ajoutée par l’IA, non validée');
  });
});

describe('questions suggérées', () => {
  it('entrelace les types et respecte la limite', () => {
    const graph = {
      nodes: [node('r'), ...'abcdefg'.split('').map((id) => node(id, 'r'))],
      edges: ['b', 'c', 'd', 'e'].map((id) =>
        edge(id, 'est lié à', 'a', { pending: true }),
      ),
    };
    const kinds = suggestedQuestions(graph).map((item) => item.kind);
    expect(kinds.slice(0, 3)).toEqual(['pending', 'vague', 'isolated']);
    expect(suggestedQuestions(graph, 2)).toHaveLength(2);
    const isolated = suggestedQuestions(graph).find(
      (item) => item.kind === 'isolated',
    )!;
    expect(isolated.question).toContain('« F », « G »');
  });

  it('rien à demander : aucune question', () => {
    expect(suggestedQuestions({ nodes: [], edges: [] })).toEqual([]);
  });
});
