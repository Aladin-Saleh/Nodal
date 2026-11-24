import { describe, expect, it } from 'vitest';
import { duplicatePairs, titleKey } from '../../src/shared/duplicates';

const same = (a: string, b: string) =>
  duplicatePairs([
    { id: 'a', title: a },
    { id: 'b', title: b },
  ]).length === 1;

describe('doublons probables', () => {
  it.each([
    ['Serveur MCP', 'serveur-mcp'],
    ['Persistance', 'Persistence'],
    ['Les Événements !', 'les evenement'],
    ['Recherche plein texte', 'Recherche en plein texte'],
    ['Base de connaissances', 'Base connaissances'],
    ['Étape 09', 'Étape 9'],
    ['Gestionnaire de fichiers', 'Gestionaire de fichiers'],
    ['Import Markdown', 'Import Makrdown'],
    ['Plein texte', 'Pleintexte'],
  ])('%s = %s', (a, b) => {
    expect(same(a, b)).toBe(true);
  });

  it.each([
    ['Kafka', 'Kafko'],
    ['Élément 0.0.1', 'Élément 0.0.2'],
    ['Appel synchrone', 'Appel asynchrone'],
    ['Graphe cyclique', 'Graphe acyclique'],
    ['Serveur A', 'Serveur B'],
    ['Page de test', 'Page de text'],
    ['Export portable', 'Export portable LLM'],
    ['Vue liste', 'Vue carte'],
    ['Migration 010', 'Migration 011'],
  ])('%s ≠ %s', (a, b) => {
    expect(same(a, b)).toBe(false);
  });

  it('un titre courant sous deux parents n’est pas un doublon', () => {
    const pairs = (x: string | null, y: string | null, title = 'Conception') =>
      duplicatePairs([
        { id: 'a', title, parentId: x },
        { id: 'b', title, parentId: y },
      ]).length;
    expect(pairs('p', 'q')).toBe(0);
    expect(pairs('p', 'p')).toBe(1);
    expect(pairs('p', 'q', 'Serveur MCP')).toBe(1);
  });

  it('clé sans accents, casse, ponctuation ni pluriel', () => {
    expect(titleKey('Les Événements !')).toBe(titleKey('les evenement'));
  });
});
