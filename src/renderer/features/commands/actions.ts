/**
 * Registre des actions de l'application : une action est décrite une seule
 * fois (libellé, raccourci, disponibilité) et réutilisée par la palette de
 * commandes, les menus, les raccourcis clavier et l'aide. Logique pure.
 */
import { fuzzyScore, queryTerms } from './fuzzy';

/** Raccourci clavier : `key` est comparée à `KeyboardEvent.key` sans casse. */
export interface Shortcut {
  key: string;
  /** Ctrl (ou Cmd). */
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type ActionGroup = 'Nœud' | 'Vue' | 'Espace' | 'Application';

export interface AppAction {
  /** Identifiant stable (ex. `node.new`), utilisé par les menus. */
  id: string;
  label: string;
  group: ActionGroup;
  /** Raccourcis : le premier est affiché, tous déclenchent l'action. */
  shortcuts?: readonly Shortcut[];
  /** Raccourci géré ailleurs (ex. Ctrl+, par l'application), affiché seulement. */
  hint?: string;
  /** Mots supplémentaires pour la recherche dans la palette. */
  keywords?: string;
  /** Faux : action grisée (menus), absente de la palette. */
  enabled: boolean;
  run(): void;
}

export function formatShortcut(shortcut: Shortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push('Ctrl');
  if (shortcut.alt) parts.push('Alt');
  if (shortcut.shift) parts.push('Maj');
  const names: Record<string, string> = {
    arrowleft: '←',
    arrowright: '→',
    ',': ',',
    ' ': 'Espace',
  };
  const key = shortcut.key.toLowerCase();
  parts.push(
    names[key] ?? (key.length === 1 ? key.toUpperCase() : shortcut.key),
  );
  return parts.join(' + ');
}

/** Libellé du premier raccourci d'une action, ou `undefined`. */
export function shortcutLabel(action: AppAction): string | undefined {
  const first = action.shortcuts?.[0];
  return first ? formatShortcut(first) : action.hint;
}

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export function matchesShortcut(event: KeyLike, shortcut: Shortcut): boolean {
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    (event.ctrlKey || event.metaKey) === Boolean(shortcut.ctrl) &&
    event.shiftKey === Boolean(shortcut.shift) &&
    event.altKey === Boolean(shortcut.alt)
  );
}

/**
 * Raccourci actif pendant la saisie dans un champ : avec Ctrl, ou touche de
 * fonction. Les autres (Alt+←…) restent à l'éditeur.
 */
export const worksWhileTyping = (shortcut: Shortcut) =>
  Boolean(shortcut.ctrl) || /^F\d{1,2}$/u.test(shortcut.key);

/**
 * Action active déclenchée par cette touche, s'il y en a une. `typing` : le
 * focus est dans un champ de saisie (voir `worksWhileTyping`).
 */
export function actionForKey(
  actions: readonly AppAction[],
  event: KeyLike,
  typing = false,
): AppAction | undefined {
  return actions.find(
    (action) =>
      action.enabled &&
      action.shortcuts?.some(
        (shortcut) =>
          matchesShortcut(event, shortcut) &&
          (!typing || worksWhileTyping(shortcut)),
      ),
  );
}

export function actionById(
  actions: readonly AppAction[],
  id: string,
): AppAction | undefined {
  return actions.find((action) => action.id === id);
}

/** Séparateur entre deux groupes d'un menu. */
export const MENU_SEPARATOR = '-';

/** Élément de menu tiré d'une action (forme de `ContextMenuItem`). */
export interface ActionMenuItem {
  label: string;
  onSelect(): void;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  separator?: boolean;
}

/**
 * Éléments d'un menu, dans l'ordre de `layout` (ids d'actions et
 * `MENU_SEPARATOR`). Actions absentes omises ; inactives grisées, ou omises
 * avec `omitDisabled`. Les ids de `danger` sont affichés en rouge.
 */
export function menuItems(
  actions: readonly AppAction[],
  layout: readonly string[],
  options: { omitDisabled?: boolean; danger?: readonly string[] } = {},
): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  let separator = false;
  for (const id of layout) {
    if (id === MENU_SEPARATOR) {
      separator = items.length > 0;
      continue;
    }
    const action = actionById(actions, id);
    if (!action || (options.omitDisabled && !action.enabled)) continue;
    items.push({
      label: action.label,
      onSelect: action.run,
      disabled: !action.enabled,
      danger: options.danger?.includes(id),
      shortcut: shortcutLabel(action),
      separator,
    });
    separator = false;
  }
  return items;
}

// --- Palette -----------------------------------------------------------------

/** Nœud proposé par la palette : titre et chemin de ses ancêtres. */
export interface PaletteNode {
  id: string;
  title: string;
  /** « Racine › Parent » ; vide pour une racine. */
  path: string;
}

export type PaletteItem =
  | { kind: 'action'; action: AppAction }
  | { kind: 'node'; node: PaletteNode };

/** Nombre maximal de propositions affichées. */
export const PALETTE_LIMIT = 50;

/**
 * Propositions de la palette pour une requête : actions disponibles et, sauf
 * en mode « actions seules », nœuds (titre, puis chemin). Sans requête : les
 * actions, dans l'ordre du registre, après les nœuds récents fournis.
 */
export function paletteItems(
  query: string,
  actions: readonly AppAction[],
  nodes: readonly PaletteNode[],
  options: { actionsOnly: boolean; recentNodes?: readonly PaletteNode[] },
): PaletteItem[] {
  const available = actions.filter((action) => action.enabled);
  const terms = queryTerms(query);
  if (terms.length === 0) {
    const recent: PaletteItem[] = options.actionsOnly
      ? []
      : (options.recentNodes ?? []).map((node) => ({ kind: 'node', node }));
    return [
      ...recent,
      ...available.map((action): PaletteItem => ({ kind: 'action', action })),
    ].slice(0, PALETTE_LIMIT);
  }
  const scored: { item: PaletteItem; score: number }[] = [];
  for (const action of available) {
    const score =
      fuzzyScore(terms, action.label) ??
      fuzzyScore(
        terms,
        `${action.group} ${action.label} ${action.keywords ?? ''}`,
      );
    if (score !== null)
      scored.push({ item: { kind: 'action', action }, score });
  }
  if (!options.actionsOnly) {
    for (const node of nodes) {
      const byTitle = fuzzyScore(terms, node.title);
      // Le chemin aide à départager, mais compte moins que le titre.
      const byPath =
        byTitle === null && node.path
          ? fuzzyScore(terms, `${node.path} ${node.title}`)
          : null;
      const score = byTitle ?? (byPath === null ? null : byPath - 50);
      if (score !== null) scored.push({ item: { kind: 'node', node }, score });
    }
  }
  return scored
    .toSorted((a, b) => b.score - a.score)
    .slice(0, PALETTE_LIMIT)
    .map(({ item }) => item);
}
