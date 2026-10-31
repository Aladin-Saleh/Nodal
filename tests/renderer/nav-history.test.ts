import { describe, expect, it } from 'vitest';
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  canStep,
  step,
  visit,
  type NavHistory,
} from '../../src/renderer/features/workspace/nav-history';
import {
  INITIAL_VIEW_STATE,
  viewReducer,
  type ViewState,
} from '../../src/renderer/features/workspace/view-state';

const all = () => true;
const visits = (...ids: string[]) =>
  ids.reduce<NavHistory>((history, id) => visit(history, id), EMPTY_HISTORY);

describe('historique de navigation', () => {
  it('empile les nœuds ouverts, sans doublon consécutif', () => {
    const history = visits('a', 'b', 'b', 'c');
    expect(history).toEqual({ entries: ['a', 'b', 'c'], index: 2 });
  });

  it('précédent puis suivant ; ouvrir un nœud oublie l’avenir', () => {
    let history = visits('a', 'b', 'c');
    history = step(history, -1, all)!;
    history = step(history, -1, all)!;
    expect(history.entries[history.index]).toBe('a');
    expect(step(history, -1, all)).toBeNull();
    history = step(history, 1, all)!;
    expect(history.entries[history.index]).toBe('b');
    history = visit(history, 'd');
    expect(history).toEqual({ entries: ['a', 'b', 'd'], index: 2 });
    expect(canStep(history, 1, all)).toBe(false);
  });

  it('saute les nœuds supprimés et le nœud courant répété', () => {
    // a, b (supprimé), a : revenir depuis le dernier « a » saute b et a.
    const history = visits('x', 'a', 'b', 'a');
    const back = step(history, -1, (id) => id !== 'b')!;
    expect(back.entries[back.index]).toBe('x');
    expect(step(visits('b', 'c'), -1, (id) => id !== 'b')).toBeNull();
  });

  it('reste bornée', () => {
    const ids = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => `n${i}`);
    const history = visits(...ids);
    expect(history.entries).toHaveLength(HISTORY_LIMIT);
    expect(history.entries[0]).toBe('n10');
    expect(history.index).toBe(HISTORY_LIMIT - 1);
  });
});

const select = (state: ViewState, id: string | null) =>
  viewReducer(state, { type: 'select', id });

describe('view-state : navigate', () => {
  it('toute sélection est mémorisée ; navigate sélectionne et déplie', () => {
    let state = select(select(select(INITIAL_VIEW_STATE, 'a'), null), 'b');
    expect(state.history.entries).toEqual(['a', 'b']);
    state = viewReducer(state, {
      type: 'navigate',
      direction: -1,
      exists: all,
      reveal: (id) => (id === 'a' ? ['root'] : []),
    });
    expect(state.selectedId).toBe('a');
    expect(state.expanded.has('root')).toBe(true);
    // Rien avant « a » : l'état ne change pas.
    const same = viewReducer(state, {
      type: 'navigate',
      direction: -1,
      exists: all,
      reveal: () => [],
    });
    expect(same).toBe(state);
  });
});
