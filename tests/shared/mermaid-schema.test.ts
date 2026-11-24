import { describe, expect, it } from 'vitest';
import {
  branchSchema,
  SCHEMA_MARKER,
  SCHEMA_MAX_EDGES,
  SCHEMA_MAX_NODES,
} from '../../src/shared/mermaid-schema';

const node = (id: string, parentId: string | null = null, title = id) => ({
  id,
  title,
  parentId,
});
const edge = (sourceId: string, targetId: string, text = 'utilise') => ({
  sourceId,
  targetId,
  text,
});

describe('schéma d’une branche', () => {
  it('groupe par sous-branche, garde les relations internes', () => {
    const { source } = branchSchema(
      [
        node('r'),
        node('a', 'r'),
        node('a1', 'a'),
        node('b', 'r'),
        node('ailleurs'),
      ],
      [
        edge('a1', 'b'),
        { ...edge('b', 'a', 'lit'), confidence: 'uncertain' as const },
        edge('a', 'ailleurs'),
      ],
      'r',
    );
    expect(source).toBe(
      [
        SCHEMA_MARKER,
        'flowchart LR',
        '  subgraph g1["a"]',
        '    n1["a"]',
        '    n3["a1"]',
        '  end',
        '  n2["b"]',
        '  n3 -->|"utilise"| n2',
        '  n2 -.->|"lit"| n1',
        '',
      ].join('\n'),
    );
  });

  it('sans relation : montre la hiérarchie', () => {
    const { source } = branchSchema([node('r'), node('a', 'r')], [], 'r');
    expect(source).toContain('n1 --- n2');
  });

  it('code les caractères de syntaxe', () => {
    const { source } = branchSchema(
      [node('r', null, 'a "b" [c] #1\n%% fin')],
      [],
      'r',
    );
    expect(source).toContain('n1["a #34;b#34; #91;c#93; #35;1 %% fin"]');
  });

  it('reste petit, dit ce qui manque', () => {
    const many = Array.from({ length: 30 }, (_, i) => node(`n${i}`, 'r'));
    const links = many.slice(1).map((item) => edge(item.id, 'n0'));
    const result = branchSchema([node('r'), ...many], links, 'r');
    expect(result.omittedNodes).toBe(30 - SCHEMA_MAX_NODES);
    expect(result.omittedEdges).toBe(29 - (SCHEMA_MAX_NODES - 1));
    expect(result.source).toContain('%% Non montrés : 12 nœuds, 12 relations');
    expect(SCHEMA_MAX_EDGES).toBeGreaterThan(SCHEMA_MAX_NODES);
    // Un cycle dans les données ne bloque pas.
    expect(() =>
      branchSchema([node('a', 'b'), node('b', 'a')], [], 'a'),
    ).not.toThrow();
  });
});
