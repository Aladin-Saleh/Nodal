/**
 * État de la vue d'un espace ouvert : sélection, dépliage de l'arborescence,
 * sélection multiple et réglages du graphe (portée, filtres, replis). Logique
 * pure (reducer), sans React : voir view-state-context.tsx pour le partage.
 */
import type { GraphViewSettings } from '../../../shared/model';
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
  /** Œil : nœuds retirés du graphe avec leurs descendants. */
  hidden: ReadonlySet<string>;
  /** Œil (Alt+clic) : branche affichée seule. */
  solo: string | null;
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
  hidden: new Set(),
  solo: null,
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
  | { type: 'toggleHidden'; id: string }
  /** Réaffiche ces nœuds (masqués eux-mêmes ou par un ancêtre masqué). */
  | { type: 'unhide'; ids: readonly string[] }
  /** Solo sur ce nœud, ou sortie du solo s'il l'est déjà. */
  | { type: 'toggleSolo'; id: string }
  | { type: 'setSolo'; id: string | null }
  /** Plus rien de masqué ni de solo. */
  | { type: 'showAll' }
  /** Réglages du graphe restaurés à l'ouverture de l'espace. */
  | { type: 'restoreGraph'; graph: GraphViewState };

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function updateGraph(
  state: ViewState,
  changes: Partial<GraphViewState>,
): ViewState {
  return { ...state, graph: { ...state.graph, ...changes } };
}

export interface ViewOptions {
  /**
   * Préférence « Lier le repli de l'arbre et du graphe » : chaque nœud déplié
   * ou replié d'un côté l'est aussi de l'autre. Seuls les changements sont
   * reportés : activer l'option ne replie pas tout le graphe d'un coup.
   */
  linkFolding?: boolean;
}

/** Ensemble modifié : ajouts puis retraits ; l'original s'il ne change pas. */
function adjusted<T>(
  set: ReadonlySet<T>,
  add: readonly T[],
  remove: readonly T[],
): ReadonlySet<T> {
  if (add.every((v) => set.has(v)) && remove.every((v) => !set.has(v))) {
    return set;
  }
  const next = new Set(set);
  for (const value of add) next.add(value);
  for (const value of remove) next.delete(value);
  return next;
}

/** Dépliés / repliés dans l'arbre : reportés dans le graphe si lié. */
function withTreeFolding(
  state: ViewState,
  opened: readonly string[],
  closed: readonly string[],
  options: ViewOptions,
): ViewState {
  const expanded = adjusted(state.expanded, opened, closed);
  if (!options.linkFolding) return { ...state, expanded };
  return {
    ...state,
    expanded,
    graph: {
      ...state.graph,
      collapsed: adjusted(state.graph.collapsed, closed, opened),
    },
  };
}

/** Repliés / dépliés dans le graphe : reportés dans l'arbre si lié. */
function withGraphFolding(
  state: ViewState,
  collapsed: ReadonlySet<string>,
  options: ViewOptions,
): ViewState {
  const next = updateGraph(state, { collapsed });
  if (!options.linkFolding) return next;
  const before = state.graph.collapsed;
  const folded = [...collapsed].filter((id) => !before.has(id));
  const unfolded = [...before].filter((id) => !collapsed.has(id));
  return { ...next, expanded: adjusted(state.expanded, unfolded, folded) };
}

export function viewReducer(
  state: ViewState,
  action: ViewAction,
  options: ViewOptions = {},
): ViewState {
  switch (action.type) {
    case 'select': {
      const opened = (action.reveal ?? []).filter(
        (id) => !state.expanded.has(id),
      );
      return {
        ...withTreeFolding(state, opened, [], options),
        selectedId: action.id,
      };
    }
    case 'setExpanded':
      if (state.expanded.has(action.id) === action.open) return state;
      return action.open
        ? withTreeFolding(state, [action.id], [], options)
        : withTreeFolding(state, [], [action.id], options);
    case 'expand':
      return withTreeFolding(state, action.ids, [], options);
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
      return withGraphFolding(state, action.ids, options);
    case 'toggleCollapsed':
      return withGraphFolding(
        state,
        toggled(state.graph.collapsed, action.id),
        options,
      );
    case 'toggleHidden':
      return updateGraph(state, {
        hidden: toggled(state.graph.hidden, action.id),
      });
    case 'unhide': {
      if (!action.ids.some((id) => state.graph.hidden.has(id))) return state;
      const hidden = new Set(state.graph.hidden);
      for (const id of action.ids) hidden.delete(id);
      return updateGraph(state, { hidden });
    }
    case 'toggleSolo':
      return updateGraph(state, {
        solo: state.graph.solo === action.id ? null : action.id,
      });
    case 'setSolo':
      return updateGraph(state, { solo: action.id });
    case 'showAll':
      return updateGraph(state, { hidden: new Set(), solo: null });
    case 'restoreGraph':
      return { ...state, graph: action.graph };
  }
}

// --- Persistance des réglages du graphe (voir view:getGraph / view:saveGraph)

/** Identifiants existants : les autres sont ignorés à la restauration. */
export interface KnownIds {
  nodeIds: ReadonlySet<string>;
  tagIds: ReadonlySet<string>;
  relationTypeIds: ReadonlySet<string>;
}

export function toGraphViewSettings(graph: GraphViewState): GraphViewSettings {
  return {
    scope: graph.scope,
    depth: graph.depth,
    nodeTypes: [...graph.filters.nodeTypes],
    tagIds: [...graph.filters.tagIds],
    hiddenRelationTypeIds: [...graph.filters.hiddenRelationTypeIds],
    showHierarchy: graph.filters.showHierarchy,
    collapsed: [...graph.collapsed],
    hidden: [...graph.hidden],
    solo: graph.solo,
    assistantPendingOnly: graph.filters.assistantPendingOnly,
  };
}

const keep = (ids: readonly string[], existing: ReadonlySet<string>) =>
  new Set(ids.filter((id) => existing.has(id)));

/** Réglages enregistrés → état de la vue, sans les identifiants disparus. */
export function fromGraphViewSettings(
  settings: GraphViewSettings,
  known: KnownIds,
): GraphViewState {
  return {
    scope: settings.scope,
    depth: settings.depth,
    filters: {
      nodeTypes: new Set(settings.nodeTypes),
      tagIds: keep(settings.tagIds, known.tagIds),
      hiddenRelationTypeIds: keep(
        settings.hiddenRelationTypeIds,
        known.relationTypeIds,
      ),
      showHierarchy: settings.showHierarchy,
      assistantPendingOnly: settings.assistantPendingOnly,
    },
    collapsed: keep(settings.collapsed, known.nodeIds),
    hidden: keep(settings.hidden, known.nodeIds),
    solo:
      settings.solo !== null && known.nodeIds.has(settings.solo)
        ? settings.solo
        : null,
  };
}
