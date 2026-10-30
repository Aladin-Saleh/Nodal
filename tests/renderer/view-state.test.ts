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
      },
      known,
    );
    expect([...restored.filters.tagIds]).toEqual(['t1']);
    expect(restored.filters.hiddenRelationTypeIds.size).toBe(0);
    expect([...restored.collapsed]).toEqual(['b']);
  });
});
