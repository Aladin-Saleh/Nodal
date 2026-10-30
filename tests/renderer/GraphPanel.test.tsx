// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import { GraphPanel } from '../../src/renderer/features/graph/GraphPanel';
import type { ViewAction } from '../../src/renderer/features/workspace/view-state';
import {
  ViewStateProvider,
  useViewDispatch,
  useViewState,
} from '../../src/renderer/features/workspace/view-state-context';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import type { GraphData, GraphNode } from '../../src/shared/model';

afterEach(cleanup);

const node = (id: string, parentId: string | null = null): GraphNode => ({
  id,
  parentId,
  title: id.toUpperCase(),
  nodeType: 'concept',
  color: null,
  x: null,
  y: null,
  z: null,
  tagIds: [],
});
// r → m → l ; autre racine o
const graph: GraphData = {
  nodes: [node('r'), node('m', 'r'), node('l', 'm'), node('o')],
  edges: [],
  relationTypes: [],
};

let latest: ReturnType<typeof useViewState> | null = null;
/** Applique un état de départ et expose l'état courant au test. */
function Setup({ actions }: { actions: ViewAction[] }) {
  const dispatch = useViewDispatch();
  latest = useViewState();
  useEffect(() => {
    for (const action of actions) dispatch(action);
    // Une seule fois, au montage.
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);
  return null;
}

function renderPanel(
  actions: ViewAction[],
  overrides: { graph?: GraphData; onValidate?: () => void } = {},
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServicesProvider
      client={{ call: vi.fn() } as unknown as NodalClient}
      tracker={new SaveTracker(() => undefined)}
      reportError={() => undefined}
      reportInfo={() => undefined}
    >
      <ViewStateProvider>
        <Setup actions={actions} />
        {children}
      </ViewStateProvider>
    </ServicesProvider>
  );
  // Sans WebGL (jsdom), la vue 3D affiche son message de repli.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <GraphPanel
      graph={overrides.graph ?? graph}
      nodes={[]}
      tags={[]}
      onSelect={vi.fn()}
      onOpen={vi.fn()}
      onPositionsSaved={vi.fn()}
      onRelationsChanged={vi.fn()}
      selectedDocuments={null}
      searchMatches={null}
      onOpenDocument={vi.fn()}
      onAddDocument={vi.fn()}
      onBulkMove={vi.fn()}
      onBulkSetType={vi.fn()}
      onBulkDelete={vi.fn()}
      onValidate={overrides.onValidate ?? vi.fn()}
      onCreateAt={vi.fn()}
    />,
    { wrapper },
  );
}

describe('œil dans le graphe', () => {
  it('compte les nœuds masqués et réaffiche tout', () => {
    renderPanel([{ type: 'toggleHidden', id: 'm' }]);
    expect(screen.getByRole('status').textContent).toContain('2 nœuds masqués');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Tout réafficher' }));
    });
    expect(latest!.graph.hidden.size).toBe(0);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('indique la branche affichée seule', () => {
    renderPanel([{ type: 'toggleSolo', id: 'm' }]);
    // Seul o (autre racine) est hors de la branche m et de ses ancêtres.
    expect(screen.getByRole('status').textContent).toBe(
      'Branche seule : « M » · 1 nœud masquéTout réafficher',
    );
  });

  it('signale une sélection masquée et la réaffiche, ancêtres compris', () => {
    renderPanel([
      { type: 'toggleHidden', id: 'r' },
      { type: 'toggleHidden', id: 'l' },
      { type: 'select', id: 'l' },
    ]);
    expect(screen.getByText(/« L » est masqué dans le graphe/)).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Le réafficher' }));
    });
    expect(latest!.graph.hidden.size).toBe(0);
    expect(screen.queryByText(/est masqué dans le graphe/)).toBeNull();
  });

  it('quitte le solo s’il laisse de côté le nœud sélectionné', () => {
    renderPanel([
      { type: 'toggleSolo', id: 'm' },
      { type: 'select', id: 'o' },
    ]);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Le réafficher' }));
    });
    expect(latest!.graph.solo).toBeNull();
  });
});

describe('validation groupée', () => {
  it('propose « Valider » pour les nœuds de la sélection ajoutés par l’IA', () => {
    const onValidate = vi.fn();
    const aiGraph: GraphData = {
      ...graph,
      nodes: graph.nodes.map((candidate) =>
        candidate.id === 'm'
          ? { ...candidate, assistantPending: true }
          : candidate,
      ),
    };
    renderPanel([{ type: 'setMultiSelection', ids: new Set(['m', 'o']) }], {
      graph: aiGraph,
      onValidate,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Valider (1)' }));
    expect(onValidate).toHaveBeenCalledWith(['m']);
  });
});
