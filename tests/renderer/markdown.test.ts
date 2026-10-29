import { describe, expect, it } from 'vitest';
import {
  createMarkdownRenderer,
  isExternalLink,
  nodeLinkTitle,
} from '../../src/renderer/features/editor/markdown';

const md = createMarkdownRenderer();

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
  });

  it('transforme [[Titre]] en lien interne vers un nœud', () => {
    const html = md.render('Voir [[API Commandes]] et [[Kafka]].');
    expect(html).toContain('class="node-link"');
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(hrefs.map(nodeLinkTitle)).toEqual(['API Commandes', 'Kafka']);
  });

  it('ne crée pas de lien interne dans un bloc de code', () => {
    expect(md.render('`[[pas un lien]]`')).not.toContain('node-link');
  });
});

describe('liens', () => {
  it('distingue liens internes et liens web', () => {
    expect(nodeLinkTitle('https://example.com')).toBeNull();
    expect(isExternalLink('https://example.com')).toBe(true);
    expect(isExternalLink('mailto:a@b.c')).toBe(false);
  });
});
