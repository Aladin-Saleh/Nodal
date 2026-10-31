/** Outils de texte partagés (recherche approximative, suggestions de liens). */

/**
 * Minuscules sans accents (« Élément » → « element »), position par
 * position : un indice du texte replié vaut pour le texte d'origine.
 */
export function foldText(text: string): string {
  let result = '';
  for (const char of text) {
    // Un caractère décomposé garde sa lettre de base (premier point de code).
    const base = char.normalize('NFD').replace(/\p{M}/gu, '');
    const folded = (base.length === 1 ? base : char).toLowerCase();
    // Rare minuscule plus longue (« İ ») : gardée telle quelle.
    result += folded.length === char.length ? folded : char;
  }
  return result;
}
