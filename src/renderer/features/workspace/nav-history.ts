/**
 * Historique de navigation (Précédent / Suivant) sur les nœuds ouverts.
 * Logique pure : une pile bornée et une position ; les nœuds supprimés depuis
 * sont sautés au moment de revenir dessus.
 */

/** Nombre maximal d'entrées gardées (les plus anciennes sont oubliées). */
export const HISTORY_LIMIT = 100;

export interface NavHistory {
  entries: readonly string[];
  /** Position courante dans `entries` ; -1 si l'historique est vide. */
  index: number;
}

export const EMPTY_HISTORY: NavHistory = { entries: [], index: -1 };

/**
 * Nœud ouvert : il devient l'entrée courante, l'avenir (Suivant) est oublié.
 * Rouvrir le nœud courant ne change rien.
 */
export function visit(history: NavHistory, id: string): NavHistory {
  if (history.entries[history.index] === id) return history;
  const entries = [...history.entries.slice(0, history.index + 1), id];
  const overflow = Math.max(0, entries.length - HISTORY_LIMIT);
  return {
    entries: entries.slice(overflow),
    index: entries.length - 1 - overflow,
  };
}

/**
 * Position atteinte en allant dans `direction` en sautant les nœuds qui
 * n'existent plus (ni le nœud courant, s'il revient deux fois de suite après
 * une suppression) ; `null` s'il n'y en a pas.
 */
export function step(
  history: NavHistory,
  direction: -1 | 1,
  exists: (id: string) => boolean,
): NavHistory | null {
  const current = history.entries[history.index];
  for (
    let index = history.index + direction;
    index >= 0 && index < history.entries.length;
    index += direction
  ) {
    const id = history.entries[index]!;
    if (id !== current && exists(id)) return { ...history, index };
  }
  return null;
}

export const canStep = (
  history: NavHistory,
  direction: -1 | 1,
  exists: (id: string) => boolean,
) => step(history, direction, exists) !== null;
