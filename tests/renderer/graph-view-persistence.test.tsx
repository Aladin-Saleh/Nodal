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
import type {
  GraphData,
  GraphViewInfo,
  GraphViewSettings,
} from '../../src/shared/model';

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
  hidden: ['a'],
  solo: 'supprimé',
  assistantPendingOnly: true,
};

/** Faux backend : vues graphe en mémoire. */
function setup(
  initial: GraphViewSettings | null,
  initialViews: GraphViewInfo[] = [],
) {
  const saved: GraphViewSettings[] = [];
  let views = [...initialViews];
  const call = vi.fn(async (channel: string, ...args: unknown[]) => {
    const input = args[0] as Record<string, unknown>;
    if (channel === 'view:getGraph') return initial;
    if (channel === 'graphView:list') return views.map((v) => ({ ...v }));
    if (channel === 'view:saveGraph') {
      saved.push(args[0] as GraphViewSettings);
      return null;
    }
    if (channel === 'graphView:create') {
      const view = {
        ...(input as Pick<GraphViewInfo, 'name' | 'settings' | 'camera'>),
        id: `v${views.length + 1}`,
        isDefault: false,
        updatedAt: 'now',
      };
      views.push(view);
      return view;
    }
    if (channel === 'graphView:update') {
      views = views.map((v) => (v.id === input.id ? { ...v, ...input } : v));
      return views.find((v) => v.id === input.id);
    }
    if (channel === 'graphView:delete') {
      views = views.filter((v) => v.id !== input.id);
      return null;
    }
    if (channel === 'graphView:setDefault') {
      views = views.map((v) => ({ ...v, isDefault: v.id === input.id }));
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
      const api = useGraphViewPersistence(data);
      return { api, state: useViewState(), dispatch: useViewDispatch() };
    },
    { wrapper, initialProps: { data: null as GraphData | null } },
  );
  return { ...hook, saved, call, views: () => views };
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
      hidden: new Set(['a']),
      solo: null,
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

  it('applique la vue par défaut (réglages et caméra) plutôt que la dernière session', async () => {
    const camera = { position: [1, 2, 3], target: [0, 0, 0] } as const;
    const { result, rerender } = setup(stored, [
      {
        id: 'v1',
        name: 'Données',
        settings: { ...stored, depth: 1, collapsed: [] },
        camera: { position: [...camera.position], target: [...camera.target] },
        isDefault: true,
        updatedAt: 'now',
      },
    ]);
    await act(async () => {});
    rerender({ data: graph });
    const { state, api } = result.current;
    expect(state.graph.depth).toBe(1);
    expect(state.activeViewId).toBe('v1');
    expect(state.cameraRequest?.camera).toEqual(camera);
    expect(api.active?.name).toBe('Données');
    expect(api.modified).toBe(false);
  });

  it('crée, signale « modifiée », met à jour, renomme et supprime une vue', async () => {
    const { result, rerender, views } = setup(null);
    await act(async () => {});
    rerender({ data: graph });
    const camera = { position: [0, 0, 9], target: [0, 0, 0] } as {
      position: [number, number, number];
      target: [number, number, number];
    };
    await act(async () => {
      await result.current.api.create('Infra', camera);
    });
    expect(result.current.api.active).toMatchObject({ name: 'Infra', camera });
    expect(result.current.api.modified).toBe(false);

    act(() => result.current.dispatch({ type: 'setDepth', depth: 4 }));
    expect(result.current.api.modified).toBe(true);
    await act(async () => {
      await result.current.api.update('v1', null);
    });
    expect(views()[0]).toMatchObject({ camera: null });
    expect(views()[0]!.settings.depth).toBe(4);
    expect(result.current.api.modified).toBe(false);

    await act(async () => {
      await result.current.api.rename('v1', 'Infrastructure');
      await result.current.api.setDefault('v1');
    });
    expect(result.current.api.views).toEqual([
      expect.objectContaining({ name: 'Infrastructure', isDefault: true }),
    ]);

    // Appliquer remet les réglages de la vue.
    act(() => result.current.dispatch({ type: 'setDepth', depth: 2 }));
    act(() => result.current.api.apply('v1'));
    expect(result.current.state.graph.depth).toBe(4);

    await act(async () => {
      await result.current.api.remove('v1');
    });
    expect(result.current.api.views).toEqual([]);
    expect(result.current.state.activeViewId).toBeNull();
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
