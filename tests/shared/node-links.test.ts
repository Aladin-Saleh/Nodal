import { describe, expect, it } from 'vitest';
import {
  NODE_LINK_PATTERN,
  buildNodeLink,
  parseNodeLink,
} from '../../src/shared/node-links';

describe('liens nodal://', () => {
  it('construit et relit un lien de nœud', () => {
    const link = buildNodeLink('3f2a9c1b-77e0', 'w1');
    expect(link).toBe('nodal://node/3f2a9c1b-77e0?espace=w1');
    expect(parseNodeLink(link)).toEqual({
      nodeId: '3f2a9c1b-77e0',
      workspaceId: 'w1',
    });
    // Identifiant abrégé (MCP), sans espace.
    expect(parseNodeLink('nodal://node/3f2a9c1b/')).toEqual({
      nodeId: '3f2a9c1b',
      workspaceId: null,
    });
  });

  it('refuse un autre protocole, un autre hôte ou un identifiant douteux', () => {
    for (const raw of [
      'https://node/abc',
      'nodal://open/abc',
      'nodal://node/',
      'nodal://node/3f2a9c1',
      'nodal://node/a%2F..%2Fb',
      'nodal://node/abc?espace=..%2Fx',
      'pas une url',
    ]) {
      expect(parseNodeLink(raw)).toBeNull();
    }
  });

  it('trouve les liens dans une ligne de texte', () => {
    const line = 'Voir nodal://node/n1?espace=w1 et nodal://node/n2.';
    expect([...line.matchAll(NODE_LINK_PATTERN)].map((m) => m[0])).toEqual([
      'nodal://node/n1?espace=w1',
      'nodal://node/n2',
    ]);
  });
});
