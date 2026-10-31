/**
 * Correspondance approximative pour la palette de commandes : chaque mot de la
 * requête doit apparaître dans le texte, lettres dans l'ordre (sous-suite),
 * sans tenir compte de la casse ni des accents. Logique pure, testée.
 */

import { foldText } from '../../../shared/text';

export { foldText };

const isBoundary = (text: string, index: number) =>
  index === 0 || /[\s\-_/.>:()[\]'’"«]/u.test(text[index - 1]!);

/**
 * Score d'un mot (déjà replié) dans un texte (replié), ou `null` s'il
 * n'apparaît pas. Préfère, dans l'ordre : une occurrence contiguë en début de
 * mot, une occurrence contiguë, puis une sous-suite aux lettres rapprochées.
 */
function termScore(term: string, text: string): number | null {
  if (term === '') return 0;
  const contiguous = text.indexOf(term);
  if (contiguous !== -1) {
    // Meilleure occurrence contiguë : en début de mot si possible.
    let at = contiguous;
    while (at !== -1 && !isBoundary(text, at)) at = text.indexOf(term, at + 1);
    if (at === 0) return 100 + term.length;
    if (at !== -1) return 80 + term.length;
    return 60 + term.length - Math.min(contiguous, 20) / 10;
  }
  // Sous-suite : chaque lettre après la précédente, dans une fenêtre bornée
  // (sinon « archi » se trouverait, lettre à lettre, dans n'importe quelle
  // phrase longue). On essaie chaque départ possible.
  const maxSpan = term.length * 3;
  let best: number | null = null;
  for (
    let start = text.indexOf(term[0]!);
    start !== -1;
    start = text.indexOf(term[0]!, start + 1)
  ) {
    const score = subsequenceScore(term, text, start, maxSpan);
    if (score !== null && (best === null || score > best)) best = score;
  }
  return best;
}

/** Score de la sous-suite commençant à `start`, ou `null` si trop étalée. */
function subsequenceScore(
  term: string,
  text: string,
  start: number,
  maxSpan: number,
): number | null {
  let score = isBoundary(text, start) ? 2 : 0;
  let previous = start;
  for (const char of term.slice(1)) {
    const at = text.indexOf(char, previous + 1);
    if (at === -1 || at - start >= maxSpan) return null;
    if (at === previous + 1) score += 3;
    else if (isBoundary(text, at)) score += 2;
    else score -= Math.min(at - previous - 1, 5) / 5;
    previous = at;
  }
  return score;
}

/** Mots de la requête, repliés ; vide si la requête l'est. */
export function queryTerms(query: string): string[] {
  return foldText(query).split(/\s+/u).filter(Boolean);
}

/**
 * Score de `text` pour les mots `terms` (voir `queryTerms`), ou `null` si l'un
 * des mots n'y figure pas. Plus le score est élevé, meilleure est la
 * correspondance ; un texte plus court l'emporte à égalité.
 */
export function fuzzyScore(
  terms: readonly string[],
  text: string,
): number | null {
  const folded = foldText(text);
  let total = 0;
  for (const term of terms) {
    const score = termScore(term, folded);
    if (score === null) return null;
    total += score;
  }
  return total - folded.length / 1000;
}
