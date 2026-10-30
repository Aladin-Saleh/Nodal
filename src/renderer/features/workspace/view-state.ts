/**
 * État de la vue d'un espace ouvert : sélection, dépliage de l'arborescence,
 * sélection multiple et réglages du graphe (portée, filtres, replis). Logique
 * pure (reducer), sans React : voir view-state-context.tsx pour le partage.
 */
import { DEFAULT_FILTERS, type GraphFilters } from '../graph/graph-model';

export type GraphScopeKind = 'all' | 'neighborhood';

export interface GraphViewState {
  /** `null` : choix automatique selon la taille de l'espace. */
  scope: GraphScopeKind | null;
  /** Niveaux du voisinage (1 à 5). */
  depth: number;
  filters: GraphFilters;
  /** Nœuds repliés : leurs descendants sont masqués, le nœud reste. */
  collapsed: ReadonlySet<string>;
}

export interface ViewState {
  selectedId: string | null;
  /** Nœuds dépliés dans l'arborescence. */
  expanded: ReadonlySet<string>;
  multiSelection: ReadonlySet<string>;
  graph: GraphViewState;
}

export const DEFAULT_GRAPH_VIEW: GraphViewState = {
  scope: null,
  depth: 2,
  filters: DEFAULT_FILTERS,
  collapsed: new Set(),
};

export const INITIAL_VIEW_STATE: ViewState = {
  selectedId: null,
  expanded: new Set(),
  multiSelection: new Set(),
  graph: DEFAULT_GRAPH_VIEW,
};

export type ViewAction =
  /** `reveal` : ancêtres à déplier pour que le nœud soit visible dans l'arbre. */
  | { type: 'select'; id: string | null; reveal?: readonly string[] }
  | { type: 'setExpanded'; id: string; open: boolean }
  | { type: 'expand'; ids: readonly string[] }
  | { type: 'setMultiSelection'; ids: ReadonlySet<string> }
  | { type: 'toggleMulti'; id: string }
  | { type: 'setScope'; scope: GraphScopeKind }
  | { type: 'setDepth'; depth: number }
  | { type: 'setFilters'; filters: GraphFilters }
  | { type: 'setCollapsed'; ids: ReadonlySet<string> }
  | { type: 'toggleCollapsed'; id: string }
  /** Réglages du graphe restaurés à l'ouverture de l'espace. */
  | { type: 'restoreGraph'; graph: GraphViewState };

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Ajoute des éléments ; renvoie l'ensemble d'origine s'il n'y a rien de nouveau. */
function withAll<T>(set: ReadonlySet<T>, values: readonly T[]): ReadonlySet<T> {
  return values.every((value) => set.has(value))
    ? set
    : new Set([...set, ...values]);
}

function updateGraph(
  state: ViewState,
  changes: Partial<GraphViewState>,
): ViewState {
  return { ...state, graph: { ...state.graph, ...changes } };
}

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'select':
      return {
        ...state,
        selectedId: action.id,
        expanded: withAll(state.expanded, action.reveal ?? []),
      };
    case 'setExpanded': {
      if (state.expanded.has(action.id) === action.open) return state;
      const expanded = new Set(state.expanded);
      if (action.open) expanded.add(action.id);
      else expanded.delete(action.id);
      return { ...state, expanded };
    }
    case 'expand':
      return { ...state, expanded: withAll(state.expanded, action.ids) };
    case 'setMultiSelection':
      return { ...state, multiSelection: action.ids };
    case 'toggleMulti':
      return {
        ...state,
        multiSelection: toggled(state.multiSelection, action.id),
      };
    case 'setScope':
      return updateGraph(state, { scope: action.scope });
    case 'setDepth':
      return updateGraph(state, { depth: action.depth });
    case 'setFilters':
      return updateGraph(state, { filters: action.filters });
    case 'setCollapsed':
      return updateGraph(state, { collapsed: action.ids });
    case 'toggleCollapsed':
      return updateGraph(state, {
        collapsed: toggled(state.graph.collapsed, action.id),
      });
    case 'restoreGraph':
      return { ...state, graph: action.graph };
  }
}
