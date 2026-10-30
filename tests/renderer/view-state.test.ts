import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPH_VIEW,
  fromGraphViewSettings,
  INITIAL_VIEW_STATE,
  toGraphViewSettings,
  viewReducer,
  type ViewState,
} from '../../src/renderer/features/workspace/view-state';

const apply = (...actions: Parameters<typeof viewReducer>[1][]) =>
  actions.reduce<ViewState>(viewReducer, INITIAL_VIEW_STATE);

describe('viewReducer', () => {
  it('sélectionne un nœud en dépliant ses ancêtres dans l’arbre', () => {
    const state = apply(
      { type: 'setExpanded', id: 'x', open: true },
      { type: 'select', id: 'c', reveal: ['a', 'b'] },
    );
    expect(state.selectedId).toBe('c');
    expect([...state.expanded].toSorted()).toEqual(['a', 'b', 'x']);
  });

  it('garde le même ensemble quand rien n’est à déplier', () => {
    const before = apply({ type: 'expand', ids: ['a'] });
    const after = viewReducer(before, {
      type: 'select',
      id: 'b',
      reveal: ['a'],
    });
    expect(after.expanded).toBe(before.expanded);
  });

  it('plie, déplie et ignore un changement sans effet', () => {
    const open = apply({ type: 'setExpanded', id: 'a', open: true });
    expect(
      viewReducer(open, { type: 'setExpanded', id: 'a', open: true }),
    ).toBe(open);
    expect(
      viewReducer(open, { type: 'setExpanded', id: 'a', open: false }).expanded
        .size,
    ).toBe(0);
  });

  it('bascule un nœud dans la sélection multiple', () => {
    const state = apply(
      { type: 'toggleMulti', id: 'a' },
      { type: 'toggleMulti', id: 'b' },
      { type: 'toggleMulti', id: 'a' },
    );
    expect([...state.multiSelection]).toEqual(['b']);
  });

  it('règle la portée, les niveaux, les filtres et les replis du graphe', () => {
    const filters = { ...DEFAULT_GRAPH_VIEW.filters, showHierarchy: false };
    const state = apply(
      { type: 'setScope', scope: 'neighborhood' },
      { type: 'setDepth', depth: 4 },
      { type: 'setFilters', filters },
      { type: 'toggleCollapsed', id: 'r' },
    );
    expect(state.graph).toEqual({
      scope: 'neighborhood',
      depth: 4,
      filters,
      collapsed: new Set(['r']),
      hidden: new Set(),
      solo: null,
    });
    expect(
      viewReducer(state, { type: 'toggleCollapsed', id: 'r' }).graph.collapsed
        .size,
    ).toBe(0);
  });

  it('restaure les réglages du graphe sans toucher à la sélection', () => {
    const selected = apply({ type: 'select', id: 'a' });
    const graph = { ...DEFAULT_GRAPH_VIEW, depth: 5 };
    const state = viewReducer(selected, { type: 'restoreGraph', graph });
    expect(state.graph).toBe(graph);
    expect(state.selectedId).toBe('a');
  });
});

describe('réglages du graphe enregistrés', () => {
  const known = {
    nodeIds: new Set(['a', 'b']),
    tagIds: new Set(['t1']),
    relationTypeIds: new Set(['uses']),
  };

  it('fait l’aller-retour état → réglages → état', () => {
    const graph = {
      scope: 'neighborhood' as const,
      depth: 3,
      filters: {
        nodeTypes: new Set(['data' as const]),
        tagIds: new Set(['t1']),
        hiddenRelationTypeIds: new Set(['uses']),
        showHierarchy: false,
      },
      collapsed: new Set(['a']),
      hidden: new Set(['b']),
      solo: 'a',
    };
    expect(fromGraphViewSettings(toGraphViewSettings(graph), known)).toEqual(
      graph,
    );
  });

  it('ignore les nœuds, tags et types de relations qui n’existent plus', () => {
    const restored = fromGraphViewSettings(
      {
        scope: null,
        depth: 2,
        nodeTypes: [],
        tagIds: ['t1', 'supprimé'],
        hiddenRelationTypeIds: ['ancien'],
        showHierarchy: true,
        collapsed: ['b', 'disparu'],
        hidden: ['disparu', 'a'],
        solo: 'disparu',
      },
      known,
    );
    expect([...restored.hidden]).toEqual(['a']);
    expect(restored.solo).toBeNull();
    expect([...restored.filters.tagIds]).toEqual(['t1']);
    expect(restored.filters.hiddenRelationTypeIds.size).toBe(0);
    expect([...restored.collapsed]).toEqual(['b']);
  });
});

describe('œil dans l’état de la vue', () => {
  it('masque, réaffiche et passe en solo', () => {
    let state = apply(
      { type: 'toggleHidden', id: 'a' },
      { type: 'toggleHidden', id: 'b' },
      { type: 'toggleSolo', id: 'r' },
    );
    expect([...state.graph.hidden]).toEqual(['a', 'b']);
    expect(state.graph.solo).toBe('r');
    state = viewReducer(state, { type: 'unhide', ids: ['b', 'x'] });
    expect([...state.graph.hidden]).toEqual(['a']);
    // Re-Alt+clic sur la même branche : sortie du solo.
    expect(viewReducer(state, { type: 'toggleSolo', id: 'r' }).graph.solo).toBe(
      null,
    );
    const cleared = viewReducer(state, { type: 'showAll' });
    expect(cleared.graph.hidden.size).toBe(0);
    expect(cleared.graph.solo).toBeNull();
  });

  it('ne change rien quand il n’y a rien à réafficher', () => {
    const state = apply({ type: 'toggleHidden', id: 'a' });
    expect(viewReducer(state, { type: 'unhide', ids: ['z'] })).toBe(state);
  });
});
