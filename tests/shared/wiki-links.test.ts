import { describe, expect, it } from 'vitest';
import {
  createLinkResolver,
  formatNodeLink,
  linkedNodeIds,
  parseWikiLinks,
  rewriteWikiLinks,
} from '../../src/shared/wiki-links';

const ID = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const OTHER = '11111111-2222-4333-8444-555555555555';

describe('analyse des liens [[...]]', () => {
  it('reconnaît les liens par identifiant et par titre, avec texte', () => {
    const body = `Voir [[node:${ID}]], [[node:${ID}|le cache]] et [[Redis|base]] ou [[Kafka]].`;
    expect(
      parseWikiLinks(body).map(({ target, text }) => ({ target, text })),
    ).toEqual([
      { target: { kind: 'id', id: ID }, text: null },
      { target: { kind: 'id', id: ID }, text: 'le cache' },
      { target: { kind: 'title', title: 'Redis' }, text: 'base' },
      { target: { kind: 'title', title: 'Kafka' }, text: null },
    ]);
  });

  it('ignore le code, les identifiants invalides et les liens vides', () => {
    const body = [
      '`[[Dans du code]]`',
      '```',
      '[[Dans un bloc]]',
      '```',
      '[[node:pas-un-uuid]] [[ ]] [[Valide]]',
    ].join('\n');
    expect(parseWikiLinks(body).map((link) => link.target)).toEqual([
      { kind: 'title', title: 'Valide' },
    ]);
  });

  it('donne les positions exactes et réécrit les liens', () => {
    const body = 'a [[X]] b [[Y|z]] c';
    const [first] = parseWikiLinks(body);
    expect(body.slice(first!.start, first!.end)).toBe('[[X]]');
    expect(
      rewriteWikiLinks(body, (link) =>
        link.target.kind === 'title' && link.target.title === 'X'
          ? formatNodeLink(ID, 'x')
          : null,
      ),
    ).toBe(`a [[node:${ID}|x]] b [[Y|z]] c`);
  });

  it('résout par identifiant ou par titre (sans casse), sans doublon', () => {
    const resolver = createLinkResolver([
      { id: ID, title: 'Cache Redis' },
      { id: OTHER, title: 'Kafka' },
    ]);
    const body = `[[cache redis]] [[node:${ID}]] [[KAFKA]] [[Inconnu]] [[node:${'9'.repeat(8)}-0000-4000-8000-000000000000]]`;
    expect(linkedNodeIds(body, resolver)).toEqual([ID, OTHER]);
  });
});
