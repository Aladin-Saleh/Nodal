// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import {
  DEFAULT_PREFERENCES,
  type AppPreferences,
} from '../../src/shared/preferences';

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
  const externalListeners = new Set<() => void>();
  const linkListeners = new Set<() => void>();
  const preferenceListeners = new Set<(preferences: AppPreferences) => void>();
  const nodes: NodeSummary[] = [];
  const defaults: Handlers = {
    'app:getInfo': () => ({
      appName: 'Nodal',
      appVersion: '0.1.0',
      electronVersion: '45.1.0',
      chromeVersion: '1',
      nodeVersion: '24',
      sqliteVersion: '3.53.0',
      mcpServerPath: 'C:/Nodal/resources/nodal-mcp.cjs',
      nodePath: 'node',
    }),
    'app:setUnsavedChanges': () => null,
    'preferences:get': () => DEFAULT_PREFERENCES,
    'preferences:update': (changes) => ({ ...DEFAULT_PREFERENCES, ...changes }),
    'workspace:getCurrent': () => null,
    'workspace:listRecent': () => [],
    'link:takePending': () => null,
    'workspace:create': () => workspace,
    'workspace:close': () => null,
    'node:list': () => [...nodes],
    'graph:get': () => ({
      nodes: nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        title: node.title,
        nodeType: node.nodeType,
        color: node.color,
        x: null,
        y: null,
        z: null,
        tagIds: [],
      })),
      edges: [],
      relationTypes: [],
    }),
    'edge:listForNode': () => [],
    'node:backlinks': () => [],
    'suggestion:listForNode': () => [],
    'view:getGraph': () => null,
    'graphView:list': () => [],
    'view:saveGraph': () => null,
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
        createdByAssistant: null,
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
    onPreferencesChanged: (listener) => {
      preferenceListeners.add(listener);
      return () => preferenceListeners.delete(listener);
    },
    onTerminalEvent: () => () => undefined,
    onNodeLink: (listener) => {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    onExternalChange: (listener) => {
      externalListeners.add(listener);
      return () => externalListeners.delete(listener);
    },
  };
  /** Simule une écriture du serveur MCP détectée par le main. */
  const emitExternalChange = () => {
    for (const listener of externalListeners) listener();
  };
  /** Simule un changement de préférences poussé par le main. */
  const emitPreferences = (preferences: AppPreferences) => {
    for (const listener of preferenceListeners) listener(preferences);
  };
  /** Simule un lien nodal:// reçu par le main. */
  const emitNodeLink = () => {
    for (const listener of linkListeners) listener();
  };
  return { client, call, emitExternalChange, emitPreferences, emitNodeLink };
}

describe('App', () => {
  it('lancé par un lien nodal://, ouvre l’espace du nœud et le sélectionne', async () => {
    const node: NodeSummary = {
      id: 'n1',
      parentId: null,
      title: 'Kafka',
      nodeType: 'component',
      color: null,
      sortOrder: 0,
    };
    let pending: IpcResultData<'link:takePending'> = {
      kind: 'node',
      nodeId: 'n1',
      workspaceId: 'w1',
      recentId: 'r1',
    };
    const { client, call, emitNodeLink } = fakeClient({
      'link:takePending': () => {
        const target = pending;
        pending = null;
        return target;
      },
      'workspace:openRecent': () => workspace,
      'node:list': () => [node],
      'graph:get': () => ({
        nodes: [{ ...node, x: null, y: null, z: null, tagIds: [] }],
        edges: [],
        relationTypes: [],
      }),
    });
    render(<App client={client} />);
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('workspace:openRecent', { id: 'r1' }),
    );
    const item = await screen.findByRole('treeitem', { name: /Kafka/ });
    await waitFor(() =>
      expect(item.getAttribute('aria-selected')).toBe('true'),
    );

    // Lien reçu plus tard, vers un nœud introuvable : message d'erreur.
    pending = {
      kind: 'missing',
      message: 'Ce nœud n’est dans aucun espace récent.',
    };
    emitNodeLink();
    expect((await screen.findByRole('alert')).textContent).toContain(
      'aucun espace récent',
    );
  });

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
    // Vue Graphe par défaut (WebGL absent sous jsdom : message de repli).
    // Message affiché par un effet de la vue 3D : à attendre, pas à lire aussitôt.
    expect(
      await screen.findByText(/rendu 3D n’est pas disponible/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Documents' }));
    // La fiche du nœud créé est ouverte.
    expect(await screen.findByDisplayValue('Kafka')).toBeTruthy();
    expect(
      screen.getByText('Ce nœud ne contient aucun document.'),
    ).toBeTruthy();
  });

  it('recharge l’arborescence après une écriture de l’assistant IA', async () => {
    const listed: NodeSummary[] = [];
    const { client, emitExternalChange } = fakeClient({
      'workspace:getCurrent': () => workspace,
      'node:list': () => [...listed],
    });
    render(<App client={client} />);
    expect(await screen.findByText('Cet espace est vide.')).toBeTruthy();

    listed.push({
      id: 'n1',
      parentId: null,
      title: 'Ajouté par l’IA',
      nodeType: 'concept',
      color: null,
      sortOrder: 0,
    });
    // Émis avant que l'écran ne s'abonne, l'événement serait perdu.
    const tree = await waitFor(() => {
      act(() => emitExternalChange());
      return screen.getByRole('tree');
    });
    expect(
      await within(tree).findByText('Ajouté par l’IA', {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        'Espace mis à jour par l’assistant IA.',
        {},
        { timeout: 5000 },
      ),
    ).toBeTruthy();
  });

  it('Ctrl+P ouvre un nœud ; Ctrl+Maj+P lance une action', async () => {
    const { client, call } = fakeClient({
      'workspace:getCurrent': () => workspace,
    });
    render(<App client={client} />);
    // Deux nœuds, créés par le faux backend.
    for (const title of ['Kafka', 'Zookeeper']) {
      fireEvent.click(await screen.findByRole('button', { name: '+ Racine' }));
      const dialog = screen.getByRole('dialog', {
        name: 'Nouveau nœud racine',
      });
      fireEvent.change(within(dialog).getByLabelText('Titre'), {
        target: { value: title },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Créer' }));
      await within(await screen.findByRole('tree')).findByText(title);
    }

    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true });
    const input = screen.getByRole('combobox', {
      name: 'Aller à un nœud ou lancer une action',
    });
    fireEvent.change(input, { target: { value: 'kfk' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(
      screen.queryByRole('dialog', { name: 'Palette de commandes' }),
    ).toBeNull();
    await waitFor(() =>
      expect(call).toHaveBeenLastCalledWith('node:get', { id: 'n1' }),
    );

    fireEvent.keyDown(document.body, {
      key: 'P',
      ctrlKey: true,
      shiftKey: true,
    });
    const actions = screen.getByRole('combobox', {
      name: 'Aller à un nœud ou lancer une action',
    });
    fireEvent.change(actions, { target: { value: '>aide' } });
    fireEvent.keyDown(actions, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'Aide' })).toBeTruthy();
  });

  it('Alt+← / Alt+→ et les boutons de la souris parcourent l’historique', async () => {
    const { client, call } = fakeClient({
      'workspace:getCurrent': () => workspace,
    });
    render(<App client={client} />);
    for (const title of ['Kafka', 'Zookeeper']) {
      fireEvent.click(await screen.findByRole('button', { name: '+ Racine' }));
      const dialog = screen.getByRole('dialog', {
        name: 'Nouveau nœud racine',
      });
      fireEvent.change(within(dialog).getByLabelText('Titre'), {
        target: { value: title },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Créer' }));
      await within(await screen.findByRole('tree')).findByText(title);
    }
    const back = screen.getByRole('button', { name: 'Nœud précédent' });
    const forward = screen.getByRole('button', { name: 'Nœud suivant' });
    expect((forward as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() =>
      expect(call).toHaveBeenLastCalledWith('node:get', { id: 'n2' }),
    );

    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    await waitFor(() =>
      expect(call).toHaveBeenLastCalledWith('node:get', { id: 'n1' }),
    );
    expect((back as HTMLButtonElement).disabled).toBe(true);
    fireEvent.mouseUp(document.body, { button: 4 });
    await waitFor(() =>
      expect(call).toHaveBeenLastCalledWith('node:get', { id: 'n2' }),
    );
    fireEvent.click(back);
    await waitFor(() =>
      expect(call).toHaveBeenLastCalledWith('node:get', { id: 'n1' }),
    );
  });

  it('« Chemin vers… » : choix de la cible, panneau, fermeture', async () => {
    const { client } = fakeClient({
      'workspace:getCurrent': () => workspace,
    });
    render(<App client={client} />);
    for (const title of ['Kafka', 'Zookeeper']) {
      fireEvent.click(await screen.findByRole('button', { name: '+ Racine' }));
      const dialog = screen.getByRole('dialog', {
        name: 'Nouveau nœud racine',
      });
      fireEvent.change(within(dialog).getByLabelText('Titre'), {
        target: { value: title },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Créer' }));
      await within(await screen.findByRole('tree')).findByText(title);
    }
    // Menu contextuel de « Kafka » → Chemin vers…
    fireEvent.contextMenu(within(screen.getByRole('tree')).getByText('Kafka'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chemin vers…' }));
    const picker = screen.getByRole('combobox', {
      name: 'Chemin depuis « Kafka » vers…',
    });
    fireEvent.change(picker, { target: { value: 'zoo' } });
    // Le nœud de départ n'est pas proposé.
    expect(
      within(
        screen.getByRole('listbox', { name: 'Propositions' }),
      ).getAllByRole('option'),
    ).toHaveLength(1);
    fireEvent.keyDown(picker, { key: 'Enter' });

    const panel = await screen.findByRole('region', { name: 'Chemin' });
    expect(within(panel).getByRole('status').textContent).toContain(
      'Aucun chemin entre « Kafka » et « Zookeeper »',
    );
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Fermer le chemin' }),
    );
    expect(screen.queryByRole('region', { name: 'Chemin' })).toBeNull();

    // « Impact d’un changement » : même menu.
    fireEvent.contextMenu(within(screen.getByRole('tree')).getByText('Kafka'));
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Impact d’un changement' }),
    );
    const impact = await screen.findByRole('region', { name: 'Impact' });
    expect(within(impact).getByRole('status').textContent).toContain(
      'Aucun nœud ne dépend de « Kafka »',
    );
    fireEvent.click(
      within(impact).getByRole('button', { name: 'Fermer l’impact' }),
    );
    expect(screen.queryByRole('region', { name: 'Impact' })).toBeNull();
  });

  it('crée un nœud depuis un sujet à documenter, puis le marque traité', async () => {
    const { client, call } = fakeClient({
      'workspace:getCurrent': () => workspace,
      'health:report': () => ({
        checks: [],
        questions: [],
        gaps: [
          {
            key: 'rollback',
            query: 'Rollback',
            count: 2,
            firstAt: '2026-10-30T10:00:00.000Z',
            lastAt: '2026-10-31T10:00:00.000Z',
            status: 'open' as const,
          },
        ],
      }),
      'gap:setStatus': () => null,
    });
    render(<App client={client} />);
    await screen.findByRole('button', { name: '+ Racine' });
    // L'écran n'écoute le clavier qu'après son premier effet.
    const palette = await waitFor(() => {
      fireEvent.keyDown(document.body, {
        key: 'P',
        ctrlKey: true,
        shiftKey: true,
      });
      return screen.getByRole('combobox', {
        name: 'Aller à un nœud ou lancer une action',
      });
    });
    fireEvent.change(palette, { target: { value: '>sujets' } });
    fireEvent.keyDown(palette, { key: 'Enter' });
    const gaps = await screen.findByRole('region', {
      name: 'Sujets à documenter',
    });
    fireEvent.click(
      within(gaps).getByRole('button', { name: 'Créer un nœud' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Nouveau nœud racine' });
    expect(
      (within(dialog).getByLabelText('Titre') as HTMLInputElement).value,
    ).toBe('Rollback');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer' }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('gap:setStatus', {
        key: 'rollback',
        status: 'done',
      }),
    );
    expect(call).toHaveBeenCalledWith('node:create', {
      parentId: null,
      title: 'Rollback',
      nodeType: 'concept',
    });
  });

  it('revient à l’accueil après fermeture de l’espace', async () => {
    const { client, call } = fakeClient({
      'workspace:getCurrent': () => workspace,
    });
    render(<App client={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Espace' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fermer l’espace' }));

    expect(
      await screen.findByRole('heading', { name: 'Créer un espace' }),
    ).toBeTruthy();
    expect(call).toHaveBeenCalledWith('workspace:close');
  });
});

describe('Préférences', () => {
  const recentEntry = {
    id: 'r1',
    name: 'Base infra',
    filePath: 'C:\\kb\\infra.nodal',
    lastOpenedAt: '2026-10-29T12:00:00.000Z',
    exists: true,
  };

  it('rouvre le dernier espace au démarrage', async () => {
    const { client, call } = fakeClient({
      'workspace:listRecent': () => [recentEntry],
      'workspace:openRecent': () => workspace,
    });
    render(<App client={client} />);
    expect(await screen.findByRole('button', { name: 'Espace' })).toBeTruthy();
    expect(call).toHaveBeenCalledWith('workspace:openRecent', { id: 'r1' });
  });

  it('reste sur l’accueil si la préférence est désactivée', async () => {
    const { client, call } = fakeClient({
      'preferences:get': () => ({
        ...DEFAULT_PREFERENCES,
        reopenLastWorkspace: false,
      }),
      'workspace:listRecent': () => [recentEntry],
    });
    render(<App client={client} />);
    expect(await screen.findByText('Base infra')).toBeTruthy();
    expect(call).not.toHaveBeenCalledWith('workspace:openRecent', {
      id: 'r1',
    });
  });

  it('s’ouvrent avec Ctrl+, et s’appliquent aussitôt', async () => {
    const { client, call } = fakeClient();
    render(<App client={client} />);
    await screen.findByText('Nodal v0.1.0');
    fireEvent.keyDown(window, { key: ',', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Préférences' });

    fireEvent.click(within(dialog).getByRole('radio', { name: 'Vert' }));
    expect(call).toHaveBeenCalledWith('preferences:update', {
      accent: 'green',
    });
    await waitFor(() =>
      expect(document.documentElement.dataset.accent).toBe('green'),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Compacte' }));
    await waitFor(() =>
      expect(document.documentElement.dataset.density).toBe('compact'),
    );
    expect(
      within(dialog)
        .getByRole('button', { name: 'Compacte' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('suivent un changement venu du main (raccourci de zoom)', async () => {
    const { client, emitPreferences } = fakeClient();
    render(<App client={client} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Préférences' }));
    const dialog = await screen.findByRole('dialog', { name: 'Préférences' });
    act(() => emitPreferences({ ...DEFAULT_PREFERENCES, zoom: 125 }));
    expect(
      (within(dialog).getByLabelText('Taille du texte') as HTMLSelectElement)
        .value,
    ).toBe('125');
  });
});

describe('menu contextuel de l’arborescence', () => {
  it('« Renommer » ouvre la fiche en vue Documents, titre sélectionné', async () => {
    const { client } = fakeClient({
      'workspace:getCurrent': () => workspace,
    });
    render(<App client={client} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Racine' }));
    const dialog = screen.getByRole('dialog', { name: 'Nouveau nœud racine' });
    fireEvent.change(within(dialog).getByLabelText('Titre'), {
      target: { value: 'Kafka' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer' }));
    const row = await within(await screen.findByRole('tree')).findByText(
      'Kafka',
    );

    fireEvent.contextMenu(row, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Renommer' }));
    const title = (await screen.findByLabelText(
      'Titre du nœud',
      {},
      { timeout: 5000 },
    )) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(title.value).toBe('Kafka');
    expect(
      screen.getByRole('button', { name: 'Documents', pressed: true }),
    ).toBeTruthy();
  });
});
