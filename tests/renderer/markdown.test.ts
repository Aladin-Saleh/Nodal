import { describe, expect, it } from 'vitest';
import {
  createMarkdownRenderer,
  isBrokenLink,
  isExternalLink,
  nodeLinkId,
} from '../../src/renderer/features/editor/markdown';
import {
  createLinkResolver,
  formatNodeLink,
} from '../../src/shared/wiki-links';

const md = createMarkdownRenderer();
const ID = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const links = createLinkResolver([
  { id: ID, title: 'API Commandes' },
  { id: '11111111-2222-4333-8444-555555555555', title: 'Kafka' },
]);
const hrefsOf = (html: string) =>
  [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!);

describe('rendu Markdown', () => {
  it('rend titres, listes, tableaux, citations et blocs de code (§6.3)', () => {
    const html = md.render(
      '# Titre\n\n- un\n- deux\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n> cité\n\n```sql\nSELECT 1;\n```',
    );
    expect(html).toContain('<h1>Titre</h1>');
    expect(html).toContain('<li>un</li>');
    expect(html).toContain('<table>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<code class="language-sql">SELECT 1;');
  });

  it('échappe le HTML brut : aucun script ni gestionnaire d’événement', () => {
    const html = md.render(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('refuse les liens javascript:, data: et file:', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///C:/x',
    ]) {
      expect(md.render(`[lien](${url})`)).not.toContain('href=');
    }
    expect(md.render('[site](https://example.com)')).toContain(
      'href="https://example.com"',
    );
    // Liens vers un nœud (nodal://node/…) gardés ; autre forme refusée.
    expect(md.render('[nœud](nodal://node/3f2a9c1b?espace=w1)')).toContain(
      'href="nodal://node/3f2a9c1b?espace=w1"',
    );
    expect(md.render('[x](nodal://open/n1)')).not.toContain('href=');
  });

  it('transforme [[Titre]] et [[node:id]] en liens vers le nœud, par identifiant', () => {
    const html = md.render(
      `Voir [[api commandes]], ${formatNodeLink(ID)} et [[Kafka|le bus]].`,
      { links },
    );
    expect(hrefsOf(html).map(nodeLinkId)).toEqual([
      ID,
      ID,
      '11111111-2222-4333-8444-555555555555',
    ]);
    // Titre courant du nœud, ou texte donné après « | ».
    expect(html).toContain('>API Commandes</a>');
    expect(html).toContain('>le bus</a>');
  });

  it('signale un lien cassé sans le rendre navigable', () => {
    const html = md.render(
      `[[Inconnu]] ${formatNodeLink('99999999-0000-4000-8000-000000000000', 'ancien')}`,
      { links },
    );
    expect(html.match(/node-link broken/g)).toHaveLength(2);
    expect(hrefsOf(html).every(isBrokenLink)).toBe(true);
    expect(hrefsOf(html).map(nodeLinkId)).toEqual([null, null]);
    expect(html).toContain('>Inconnu</a>');
    expect(html).toContain('>ancien</a>');
  });

  it('échappe le texte d’un lien', () => {
    const html = md.render('[[<img src=x onerror=alert(1)>]]', { links });
    expect(html).not.toContain('<img');
  });

  it('ne crée pas de lien interne dans un bloc de code', () => {
    expect(md.render('`[[pas un lien]]`')).not.toContain('node-link');
  });
});

describe('liens', () => {
  it('distingue liens internes et liens web', () => {
    expect(nodeLinkId('https://example.com')).toBeNull();
    expect(isExternalLink('https://example.com')).toBe(true);
    expect(isExternalLink('mailto:a@b.c')).toBe(false);
  });
});
