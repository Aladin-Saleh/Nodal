// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  actionForKey,
  formatShortcut,
  paletteItems,
  type AppAction,
  type PaletteNode,
} from '../../src/renderer/features/commands/actions';
import { CommandPalette } from '../../src/renderer/features/commands/CommandPalette';
import {
  foldText,
  fuzzyScore,
  queryTerms,
} from '../../src/renderer/features/commands/fuzzy';
import { shortcutList } from '../../src/renderer/features/workspace/HelpDialog';
import {
  nodeActions,
  workspaceActions,
  type WorkspaceActionState,
  type WorkspaceCommands,
} from '../../src/renderer/features/workspace/workspace-actions';
import type { NodeSummary } from '../../src/shared/model';

afterEach(cleanup);

const score = (query: string, text: string) =>
  fuzzyScore(queryTerms(query), text);

describe('correspondance approximative', () => {
  it('ignore la casse et les accents', () => {
    expect(foldText('Élément Œuvre')).toBe('element œuvre');
    expect(score('element', 'Élément')).not.toBeNull();
    expect(score('ÉLÉ', 'element')).not.toBeNull();
  });

  it('exige chaque mot, lettres dans l’ordre', () => {
    expect(score('srv mcp', 'Serveur MCP')).not.toBeNull();
    expect(score('mcp srv', 'Serveur MCP')).not.toBeNull();
    expect(score('pcm', 'Serveur MCP')).toBeNull();
    expect(score('kafka', 'Serveur MCP')).toBeNull();
  });

  it('préfère un début de mot, puis une occurrence contiguë', () => {
    const prefix = score('graph', 'Graphe 3D')!;
    const inside = score('graph', 'Lisibilité des graphes')!;
    const middle = score('raph', 'Graphe')!;
    const scattered = score('gph', 'Graphe')!;
    expect(prefix).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(scattered);
  });
});

const action = (id: string, label: string, extra: Partial<AppAction> = {}) =>
  ({
    id,
    label,
    group: 'Espace',
    enabled: true,
    run: vi.fn(),
    ...extra,
  }) satisfies AppAction;

const nodes: PaletteNode[] = [
  { id: 'n1', title: 'Serveur MCP', path: 'Nodal › Architecture' },
  { id: 'n2', title: 'Graphe 3D', path: 'Nodal › Fonctionnalités' },
  { id: 'n3', title: 'Persistance', path: 'Nodal › Architecture' },
];

const paletteActions = [
  action('export', 'Exporter l’espace'),
  action('off', 'Graphe désactivé', { enabled: false }),
];

const titles = (query: string, actionsOnly = false) =>
  paletteItems(query, paletteActions, nodes, { actionsOnly }).map((item) =>
    item.kind === 'node' ? item.node.title : item.action.label,
  );

const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('propositions de la palette', () => {
  const actions = paletteActions;

  it('cherche les nœuds par titre puis par chemin, et les actions', () => {
    expect(titles('graphe')).toEqual(['Graphe 3D']);
    // « archi » n'est que dans le chemin : les deux nœuds concernés.
    expect(titles('archi').toSorted()).toEqual(['Persistance', 'Serveur MCP']);
    expect(titles('export')).toEqual(['Exporter l’espace']);
    expect(titles('graphe', true)).toEqual([]);
  });

  it('sans requête : nœuds récents puis actions actives', () => {
    const items = paletteItems('', actions, nodes, {
      actionsOnly: false,
      recentNodes: [nodes[2]!],
    });
    expect(items.map((item) => item.kind)).toEqual(['node', 'action']);
  });
});

describe('raccourcis', () => {
  const actions = [
    action('newRoot', 'Racine', {
      shortcuts: [{ key: 'n', ctrl: true, shift: true }],
    }),
    action('new', 'Enfant', { shortcuts: [{ key: 'n', ctrl: true }] }),
    action('back', 'Précédent', {
      shortcuts: [{ key: 'ArrowLeft', alt: true }],
    }),
  ];

  it('distingue les modificateurs', () => {
    expect(actionForKey(actions, key('n', { ctrlKey: true }))?.id).toBe('new');
    expect(
      actionForKey(actions, key('N', { ctrlKey: true, shiftKey: true }))?.id,
    ).toBe('newRoot');
    expect(actionForKey(actions, key('n'))).toBeUndefined();
  });

  it('laisse à l’éditeur les raccourcis sans Ctrl pendant la saisie', () => {
    const altLeft = key('ArrowLeft', { altKey: true });
    expect(actionForKey(actions, altLeft)?.id).toBe('back');
    expect(actionForKey(actions, altLeft, true)).toBeUndefined();
    expect(actionForKey(actions, key('n', { ctrlKey: true }), true)?.id).toBe(
      'new',
    );
  });

  it('s’affiche en français', () => {
    expect(formatShortcut({ key: 'p', ctrl: true, shift: true })).toBe(
      'Ctrl + Maj + P',
    );
    expect(formatShortcut({ key: 'ArrowLeft', alt: true })).toBe('Alt + ←');
  });
});

describe('actions de l’espace', () => {
  const commands = new Proxy({} as WorkspaceCommands, {
    get: (target, name: string) =>
      ((target as unknown as Record<string, unknown>)[name] ??= vi.fn()),
  });
  const state: WorkspaceActionState = {
    view: 'graph',
    exporting: false,
    hidden: new Set(['a']),
    solo: null,
    masking: true,
  };
  const node: NodeSummary = {
    id: 'a',
    parentId: null,
    title: 'A',
    nodeType: 'concept',
    color: null,
    sortOrder: 0,
  };

  it('identifiants uniques, actions de nœud inactives sans nœud', () => {
    const all = [
      ...nodeActions(null, state, commands),
      ...workspaceActions(state, commands),
    ];
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
    const disabled = all.filter((a) => !a.enabled).map((a) => a.id);
    expect(disabled).toContain('node.rename');
    expect(disabled).not.toContain('node.newChild');
  });

  it('suivent l’état (masquage, vue) et appellent la bonne commande', () => {
    const actions = nodeActions(node, state, commands);
    const hide = actions.find((a) => a.id === 'node.toggleHidden')!;
    expect(hide.label).toBe('Afficher dans le graphe');
    hide.run();
    expect(commands.toggleHidden).toHaveBeenCalledWith('a');
    const toggle = workspaceActions(state, commands).find(
      (a) => a.id === 'view.toggle',
    )!;
    toggle.run();
    expect(commands.setView).toHaveBeenCalledWith('documents');
  });

  it('alimentent la liste des raccourcis de l’aide', () => {
    const list = shortcutList(workspaceActions(state, commands));
    expect(list).toContainEqual(['Ctrl + P', 'Palette de commandes']);
    expect(list).toContainEqual(['Ctrl + ,', 'Préférences']);
  });
});

function setup(actionsOnly = false) {
  const run = vi.fn();
  const onOpenNode = vi.fn();
  const onClose = vi.fn();
  render(
    <CommandPalette
      actions={[action('export', 'Exporter l’espace', { run })]}
      nodes={nodes}
      actionsOnly={actionsOnly}
      onOpenNode={onOpenNode}
      onClose={onClose}
    />,
  );
  const input = screen.getByRole('combobox');
  return { run, onOpenNode, onClose, input };
}

describe('CommandPalette', () => {
  it('motif combobox : flèches, Entrée ouvre le nœud actif', () => {
    const { input, onOpenNode, onClose } = setup();
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'archi' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
    const second = options[1]!.textContent!;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onClose).toHaveBeenCalled();
    const opened = nodes.find((n) => second.includes(n.title))!;
    expect(onOpenNode).toHaveBeenCalledWith(opened.id);
  });

  it('Ctrl+Maj+P : actions seules, lancées après la fermeture', async () => {
    const { input, run, onClose } = setup(true);
    expect((input as HTMLInputElement).value).toBe('>');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onClose).toHaveBeenCalled();
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
  });

  it('Échap ferme ; aucun résultat est annoncé', () => {
    const { input, onClose } = setup();
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByRole('status').textContent).toBe('Aucun résultat.');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
