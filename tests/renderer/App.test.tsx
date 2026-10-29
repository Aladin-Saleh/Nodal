// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/app/App';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { NodalError } from '../../src/shared/errors';
import type {
  IpcArgs,
  IpcChannel,
  IpcResultData,
  WorkspaceInfo,
} from '../../src/shared/ipc-contract';
import type { NodeDetail, NodeSummary } from '../../src/shared/model';

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

type Handlers = {
  [C in IpcChannel]?: (
    ...args: IpcArgs<C>
  ) => IpcResultData<C> | Promise<IpcResultData<C>>;
};

/** Faux backend : un nœud créé apparaît dans `node:list` et `node:get`. */
function fakeClient(overrides: Handlers = {}) {
  const nodes: NodeSummary[] = [];
  const defaults: Handlers = {
    'app:getInfo': () => ({
      appName: 'Nodal',
      appVersion: '0.1.0',
      electronVersion: '45.1.0',
      chromeVersion: '1',
      nodeVersion: '24',
      sqliteVersion: '3.53.0',
    }),
    'app:setUnsavedChanges': () => null,
    'workspace:getCurrent': () => null,
    'workspace:listRecent': () => [],
    'workspace:create': () => workspace,
    'workspace:close': () => null,
    'node:list': () => [...nodes],
    'tag:list': () => [],
    'node:create': ({ parentId, title, nodeType }) => {
      const node: NodeSummary = {
        id: `n${nodes.length + 1}`,
        parentId,
        title,
        nodeType,
        color: null,
        sortOrder: nodes.length,
      };
      nodes.push(node);
      return node;
    },
    'node:get': ({ id }): NodeDetail => {
      const node = nodes.find((candidate) => candidate.id === id)!;
      return {
        ...node,
        summary: null,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        path: [],
        tags: [],
        documents: [],
        attachments: [],
        childCount: 0,
        edgeCount: 0,
      };
    },
  };
  const handlers = { ...defaults, ...overrides } as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const call = vi.fn(async (channel: string, ...args: unknown[]) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Canal non simulé : ${channel}`);
    return handler(...args);
  });
  const client: NodalClient = {
    call: call as unknown as NodalClient['call'],
    onFlushRequest: () => () => undefined,
  };
  return { client, call };
}

describe('App', () => {
  it('affiche l’écran d’accueil et la version dans la barre d’état', async () => {
    const { client } = fakeClient();
    render(<App client={client} />);
    expect(
      screen.getByRole('heading', { name: 'Créer un espace' }),
    ).toBeTruthy();
    expect(await screen.findByText('Nodal v0.1.0')).toBeTruthy();
  });

  it('crée un espace puis affiche l’espace vide', async () => {
    const { client, call } = fakeClient();
    render(<App client={client} />);

    fireEvent.change(screen.getByLabelText('Nom de l’espace'), {
      target: { value: '  Base infra ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer…' }));

    expect(await screen.findByText('Cet espace est vide.')).toBeTruthy();
    expect(call).toHaveBeenCalledWith('workspace:create', {
      name: 'Base infra',
    });
    expect(screen.getByRole('heading', { name: 'Base infra' })).toBeTruthy();
    expect(screen.getByText('Espace : Base infra')).toBeTruthy();
  });

  it('affiche une erreur lisible', async () => {
    const { client } = fakeClient({
      'workspace:open': () => {
        throw new NodalError(
          'NOT_A_NODAL_FILE',
          "Ce fichier n'est pas un espace Nodal.",
        );
      },
    });
    render(<App client={client} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir…' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      "Ce fichier n'est pas un espace Nodal.",
    );
  });

  it('crée un nœud racine et l’affiche dans l’arborescence', async () => {
    const { client, call } = fakeClient({
      'workspace:getCurrent': () => workspace,
    });
    render(<App client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Racine' }));
    const dialog = screen.getByRole('dialog', { name: 'Nouveau nœud racine' });
    fireEvent.change(within(dialog).getByLabelText('Titre'), {
      target: { value: 'Kafka' },
    });
    fireEvent.change(within(dialog).getByLabelText('Type'), {
      target: { value: 'component' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer' }));

    const tree = await screen.findByRole('tree');
    expect(await within(tree).findByText('Kafka')).toBeTruthy();
    expect(call).toHaveBeenCalledWith('node:create', {
      parentId: null,
      title: 'Kafka',
      nodeType: 'component',
    });
    // La fiche du nœud créé est ouverte.
    expect(await screen.findByDisplayValue('Kafka')).toBeTruthy();
    expect(
      screen.getByText('Ce nœud ne contient aucun document.'),
    ).toBeTruthy();
  });

  it('revient à l’accueil après fermeture de l’espace', async () => {
    const { client, call } = fakeClient({
      'workspace:getCurrent': () => workspace,
    });
    render(<App client={client} />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Fermer l’espace' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Créer un espace' }),
    ).toBeTruthy();
    expect(call).toHaveBeenCalledWith('workspace:close');
  });
});
