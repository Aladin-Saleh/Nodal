// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/app/App';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { NodalError } from '../../src/shared/errors';
import type { WorkspaceInfo } from '../../src/shared/ipc-contract';

afterEach(cleanup);

const workspace: WorkspaceInfo = {
  id: 'w1',
  name: 'Base infra',
  description: null,
  filePath: 'C:\\kb\\infra.nodal',
  schemaVersion: 1,
  createdAt: '2026-10-29T12:00:00.000Z',
  updatedAt: '2026-10-29T12:00:00.000Z',
};

function fakeClient(overrides: Partial<NodalClient> = {}): NodalClient {
  return {
    getAppInfo: vi.fn(async () => ({
      appName: 'Nodal',
      appVersion: '0.1.0',
      electronVersion: '45.1.0',
      chromeVersion: '1',
      nodeVersion: '24',
      sqliteVersion: '3.53.0',
    })),
    createWorkspace: vi.fn(async () => workspace),
    openWorkspace: vi.fn(async () => workspace),
    closeWorkspace: vi.fn(async () => undefined),
    getCurrentWorkspace: vi.fn(async () => null),
    ...overrides,
  };
}

describe('App', () => {
  it('affiche l’écran d’accueil et la version dans la barre d’état', async () => {
    render(<App client={fakeClient()} />);
    expect(
      screen.getByRole('heading', { name: 'Créer un espace' }),
    ).toBeTruthy();
    expect(await screen.findByText('Nodal v0.1.0')).toBeTruthy();
  });

  it('crée un espace puis affiche ses informations', async () => {
    const client = fakeClient();
    render(<App client={client} />);

    const create = screen.getByRole('button', { name: 'Créer…' });
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Nom de l’espace'), {
      target: { value: '  Base infra ' },
    });
    fireEvent.click(create);

    expect(
      await screen.findByRole('heading', { name: 'Base infra' }),
    ).toBeTruthy();
    expect(client.createWorkspace).toHaveBeenCalledWith({ name: 'Base infra' });
    expect(screen.getByText(workspace.filePath)).toBeTruthy();
    expect(screen.getByText('Espace : Base infra')).toBeTruthy();
  });

  it('affiche une erreur lisible', async () => {
    const client = fakeClient({
      openWorkspace: vi.fn(async () => {
        throw new NodalError(
          'NOT_A_NODAL_FILE',
          "Ce fichier n'est pas un espace Nodal.",
        );
      }),
    });
    render(<App client={client} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir…' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      "Ce fichier n'est pas un espace Nodal.",
    );
    expect(
      screen.getByRole('heading', { name: 'Créer un espace' }),
    ).toBeTruthy();
  });

  it('revient à l’accueil après fermeture de l’espace', async () => {
    const client = fakeClient({
      getCurrentWorkspace: vi.fn(async () => workspace),
    });
    render(<App client={client} />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Fermer l’espace' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Créer un espace' }),
    ).toBeTruthy();
    expect(client.closeWorkspace).toHaveBeenCalled();
  });
});
