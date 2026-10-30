// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import {
  useGraphViewPersistence,
  VIEW_SAVE_DELAY_MS,
} from '../../src/renderer/features/workspace/useGraphViewPersistence';
import {
  ViewStateProvider,
  useViewDispatch,
  useViewState,
} from '../../src/renderer/features/workspace/view-state-context';
import type { GraphData, GraphViewSettings } from '../../src/shared/model';

const graph: GraphData = {
  nodes: [
    {
      id: 'a',
      parentId: null,
      title: 'A',
      nodeType: 'concept',
      color: null,
      x: null,
      y: null,
      z: null,
      tagIds: [],
    },
  ],
  edges: [],
  relationTypes: [],
};

const stored: GraphViewSettings = {
  scope: 'neighborhood',
  depth: 4,
  nodeTypes: [],
  tagIds: [],
  hiddenRelationTypeIds: [],
  showHierarchy: true,
  collapsed: ['a', 'supprimé'],
};

function setup(initial: GraphViewSettings | null) {
  const saved: GraphViewSettings[] = [];
  const call = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'view:getGraph') return initial;
    if (channel === 'view:saveGraph') {
      saved.push(args[0] as GraphViewSettings);
      return null;
    }
    throw new Error(channel);
  });
  const client = { call } as unknown as NodalClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider
      client={client}
      tracker={new SaveTracker(() => undefined)}
      reportError={() => undefined}
      reportInfo={() => undefined}
    >
      <ViewStateProvider>{children}</ViewStateProvider>
    </ServicesProvider>
  );
  const hook = renderHook(
    ({ data }: { data: GraphData | null }) => {
      useGraphViewPersistence(data);
      return { state: useViewState(), dispatch: useViewDispatch() };
    },
    { wrapper, initialProps: { data: null as GraphData | null } },
  );
  return { ...hook, saved };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('persistance des réglages du graphe', () => {
  it('restaure les réglages une fois le graphe chargé, sans les nœuds disparus', async () => {
    const { result, rerender } = setup(stored);
    await act(async () => {});
    // Graphe pas encore chargé : rien n'est restauré.
    expect(result.current.state.graph.depth).toBe(2);
    rerender({ data: graph });
    expect(result.current.state.graph).toMatchObject({
      scope: 'neighborhood',
      depth: 4,
      collapsed: new Set(['a']),
    });
  });

  it('enregistre après un délai, en regroupant les changements rapprochés', async () => {
    const { result, rerender, saved } = setup(null);
    await act(async () => {});
    rerender({ data: graph });
    await act(async () => vi.advanceTimersByTime(VIEW_SAVE_DELAY_MS));
    saved.length = 0;
    act(() => result.current.dispatch({ type: 'setDepth', depth: 3 }));
    act(() => result.current.dispatch({ type: 'setDepth', depth: 5 }));
    expect(saved).toEqual([]);
    await act(async () => vi.advanceTimersByTime(VIEW_SAVE_DELAY_MS));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ depth: 5 });
  });

  it('n’écrase pas les réglages enregistrés avant de les avoir restaurés', async () => {
    const { result, saved } = setup(stored);
    await act(async () => {});
    act(() => result.current.dispatch({ type: 'setDepth', depth: 1 }));
    await act(async () => vi.advanceTimersByTime(VIEW_SAVE_DELAY_MS * 2));
    expect(saved).toEqual([]);
  });

  it('enregistre le dernier changement en attente à la fermeture', async () => {
    const { result, rerender, unmount, saved } = setup(null);
    await act(async () => {});
    rerender({ data: graph });
    await act(async () => vi.advanceTimersByTime(VIEW_SAVE_DELAY_MS));
    saved.length = 0;
    act(() => result.current.dispatch({ type: 'toggleCollapsed', id: 'a' }));
    unmount();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.collapsed).toEqual(['a']);
  });
});
