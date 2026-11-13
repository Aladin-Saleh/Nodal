// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphViewsMenu } from '../../src/renderer/features/graph/GraphViewsMenu';
import type { GraphViewsApi } from '../../src/renderer/features/workspace/useGraphViewPersistence';
import {
  DEFAULT_GRAPH_VIEW,
  INITIAL_VIEW_STATE,
  sameGraphViewSettings,
  toGraphViewSettings,
  viewReducer,
} from '../../src/renderer/features/workspace/view-state';
import type { GraphCamera, GraphViewInfo } from '../../src/shared/model';

afterEach(cleanup);

const camera: GraphCamera = { position: [1, 2, 3], target: [0, 0, 0] };
const settings = toGraphViewSettings(DEFAULT_GRAPH_VIEW);
const view = (id: string, name: string, isDefault = false): GraphViewInfo => ({
  id,
  name,
  settings,
  camera: null,
  isDefault,
  updatedAt: 'now',
});

function renderMenu(overrides: Partial<GraphViewsApi> = {}) {
  const api: GraphViewsApi = {
    views: [view('v1', 'Infra', true), view('v2', 'Données')],
    active: null,
    modified: false,
    apply: vi.fn(),
    create: vi.fn(async () => true),
    update: vi.fn(async () => undefined),
    rename: vi.fn(async () => true),
    remove: vi.fn(async () => undefined),
    setDefault: vi.fn(async () => undefined),
    ...overrides,
  };
  render(<GraphViewsMenu api={api} getCamera={() => camera} />);
  return api;
}

describe('GraphViewsMenu', () => {
  it('applique la vue choisie ; ★ marque la vue par défaut', () => {
    const api = renderMenu();
    const select = screen.getByLabelText('Vue enregistrée');
    expect(
      within(select).getByRole('option', { name: 'Infra ★' }),
    ).toBeTruthy();
    fireEvent.change(select, { target: { value: 'v2' } });
    expect(api.apply).toHaveBeenCalledWith('v2');
  });

  it('enregistre une nouvelle vue avec la caméra courante', async () => {
    const api = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Vues' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Enregistrer comme nouvelle vue…' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Enregistrer la vue' });
    fireEvent.change(within(dialog).getByLabelText('Nom de la vue'), {
      target: { value: '  Réseau ' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Enregistrer' }),
    );
    expect(api.create).toHaveBeenCalledWith('Réseau', camera);
    await vi.waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Enregistrer la vue' }),
      ).toBeNull(),
    );
  });

  it('vue active modifiée : mise à jour, défaut, suppression confirmée', () => {
    const active = view('v2', 'Données');
    const api = renderMenu({ active, modified: true });
    expect(screen.getByText('modifiée')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Vues' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Mettre à jour « Données »' }),
    );
    expect(api.update).toHaveBeenCalledWith('v2', camera);
    fireEvent.click(screen.getByRole('button', { name: 'Vues' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Ouvrir cette vue avec l’espace' }),
    );
    expect(api.setDefault).toHaveBeenCalledWith('v2');
    fireEvent.click(screen.getByRole('button', { name: 'Vues' }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Supprimer « Données »…' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    expect(api.remove).toHaveBeenCalledWith('v2');
  });
});

describe('view-state : vues enregistrées', () => {
  it('applyView demande la caméra, cameraApplied l’oublie', () => {
    const graph = { ...DEFAULT_GRAPH_VIEW, depth: 4 };
    let state = viewReducer(INITIAL_VIEW_STATE, {
      type: 'applyView',
      id: 'v1',
      graph,
      camera,
    });
    expect(state).toMatchObject({ activeViewId: 'v1', graph });
    expect(state.cameraRequest).toEqual({ camera, nonce: 1 });
    state = viewReducer(state, { type: 'cameraApplied' });
    expect(state.cameraRequest).toBeNull();
  });

  it('compare des réglages sans tenir compte de l’ordre des listes', () => {
    const a = { ...settings, collapsed: ['x', 'y'] };
    expect(sameGraphViewSettings(a, { ...a, collapsed: ['y', 'x'] })).toBe(
      true,
    );
    expect(sameGraphViewSettings(a, { ...a, depth: 5 })).toBe(false);
  });
});
