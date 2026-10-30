// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  NodeTree,
  type NodeTreeProps,
} from '../../src/renderer/features/nodes/NodeTree';
import { buildTreeIndex } from '../../src/renderer/features/nodes/tree';
import type { NodeSummary } from '../../src/shared/model';

afterEach(cleanup);

const node = (id: string, parentId: string | null): NodeSummary => ({
  id,
  parentId,
  title: id.toUpperCase(),
  nodeType: 'concept',
  color: null,
  sortOrder: 0,
});
const index = buildTreeIndex([node('a', null), node('b', 'a')]);

function renderTree(props: Partial<NodeTreeProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onToggle: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onToggleHidden: vi.fn(),
    onToggleSolo: vi.fn(),
  };
  render(
    <NodeTree
      index={index}
      expanded={new Set(['a'])}
      selectedId="a"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe('œil de l’arborescence', () => {
  it('masque au clic et passe en solo à l’Alt+clic, sans sélectionner la ligne', () => {
    const handlers = renderTree();
    const [eyeA] = screen.getAllByRole('button', {
      name: 'Masquer dans le graphe',
    });
    fireEvent.click(eyeA!);
    expect(handlers.onToggleHidden).toHaveBeenCalledWith('a');
    fireEvent.click(eyeA!, { altKey: true });
    expect(handlers.onToggleSolo).toHaveBeenCalledWith('a');
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it('montre un nœud masqué : bouton enfoncé, libellé « Afficher », ligne grisée', () => {
    renderTree({ hidden: new Set(['a']), masked: new Set(['a', 'b']) });
    const eye = screen.getByRole('button', { name: 'Afficher dans le graphe' });
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    const rows = screen.getAllByRole('treeitem');
    expect(rows.map((row) => row.classList.contains('masked'))).toEqual([
      true,
      true,
    ]);
    // Seul le nœud masqué lui-même garde son œil affiché en permanence.
    expect(rows[0]!.classList.contains('eye-active')).toBe(true);
    expect(rows[1]!.classList.contains('eye-active')).toBe(false);
  });

  it('masque le nœud sélectionné avec la touche H', () => {
    const handlers = renderTree();
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'h' });
    expect(handlers.onToggleHidden).toHaveBeenCalledWith('a');
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'h', ctrlKey: true });
    expect(handlers.onToggleHidden).toHaveBeenCalledOnce();
  });

  it('reste focalisable sans ajouter d’arrêt de tabulation', () => {
    renderTree();
    const [eye] = screen.getAllByRole('button', {
      name: 'Masquer dans le graphe',
    });
    expect(eye!.tabIndex).toBe(-1);
    eye!.focus();
    expect(document.activeElement).toBe(eye);
  });
});

describe('glisser-déposer dans l’arborescence', () => {
  // jsdom n'a pas de DragEvent : sans lui, clientY serait perdu.
  beforeAll(() => {
    if (!('DragEvent' in window)) {
      Object.assign(window, { DragEvent: class extends MouseEvent {} });
    }
  });

  // Ligne de 20 px : quart haut = avant, milieu = dans, quart bas = après.
  const rect = {
    top: 0,
    bottom: 20,
    left: 0,
    right: 200,
    height: 20,
    width: 200,
  };
  const drag = (from: HTMLElement, to: HTMLElement, clientY: number) => {
    const dataTransfer = {
      data: new Map<string, string>(),
      setData(type: string, value: string) {
        this.data.set(type, value);
      },
      getData(type: string) {
        return this.data.get(type) ?? '';
      },
      effectAllowed: '',
      dropEffect: '',
    };
    to.getBoundingClientRect = () => rect as DOMRect;
    fireEvent.dragStart(from, { dataTransfer });
    const accepted = fireEvent.dragOver(to, { dataTransfer, clientY });
    fireEvent.drop(to, { dataTransfer, clientY });
    return accepted;
  };
  const tree = buildTreeIndex([
    node('a', null),
    { ...node('b', null), sortOrder: 1 },
    node('c', 'a'),
  ]);

  it('déplace un nœud dans un autre, ou avant / après lui', () => {
    const onMove = vi.fn();
    renderTree({ index: tree, expanded: new Set(['a']), onMove });
    const [a, c, b] = screen.getAllByRole('treeitem');
    drag(b!, c!, 10);
    expect(onMove).toHaveBeenLastCalledWith('b', { parentId: 'c' });
    drag(b!, c!, 2);
    expect(onMove).toHaveBeenLastCalledWith('b', { parentId: 'a', index: 0 });
    drag(c!, a!, 18);
    expect(onMove).toHaveBeenLastCalledWith('c', { parentId: null, index: 1 });
  });

  it('refuse une cible interdite : un descendant du nœud glissé', () => {
    const onMove = vi.fn();
    renderTree({ index: tree, expanded: new Set(['a']), onMove });
    const [a, c] = screen.getAllByRole('treeitem');
    // dragOver non annulé : le navigateur refuse le dépôt.
    expect(drag(a!, c!, 10)).toBe(true);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('affiche où le nœud sera déposé', () => {
    renderTree({ index: tree, expanded: new Set(['a']), onMove: vi.fn() });
    const [, c, b] = screen.getAllByRole('treeitem');
    c!.getBoundingClientRect = () => rect as DOMRect;
    fireEvent.dragStart(b!, {
      dataTransfer: { setData: () => undefined, effectAllowed: '' },
    });
    fireEvent.dragOver(c!, { dataTransfer: { dropEffect: '' }, clientY: 18 });
    expect(c!.classList.contains('drop-after')).toBe(true);
  });
});

describe('menu contextuel de l’arborescence', () => {
  it('s’ouvre au clic droit, en sélectionnant le nœud', () => {
    const onContextMenu = vi.fn();
    const handlers = renderTree({ onContextMenu });
    const [, b] = screen.getAllByRole('treeitem');
    fireEvent.contextMenu(b!, { clientX: 40, clientY: 60 });
    expect(handlers.onSelect).toHaveBeenCalledWith('b');
    expect(onContextMenu).toHaveBeenCalledWith('b', { x: 40, y: 60 });
  });

  it('s’ouvre au clavier : touche Menu ou Maj+F10', () => {
    const onContextMenu = vi.fn();
    renderTree({ onContextMenu });
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ContextMenu' });
    fireEvent.keyDown(tree, { key: 'F10' });
    fireEvent.keyDown(tree, { key: 'F10', shiftKey: true });
    expect(onContextMenu).toHaveBeenCalledTimes(2);
    expect(onContextMenu.mock.calls[0]![0]).toBe('a');
  });
});

describe('ajouts de l’IA dans l’arborescence', () => {
  it('signale un nœud ajouté par l’IA et pas encore validé', () => {
    renderTree({
      index: buildTreeIndex([
        { ...node('a', null), assistantPending: true },
        { ...node('b', null), sortOrder: 1 },
      ]),
    });
    const [a, b] = screen.getAllByRole('treeitem');
    expect(a!.classList.contains('ai-pending')).toBe(true);
    expect(
      a!.querySelector('[aria-label="Ajouté par l’IA, non validé"]'),
    ).not.toBeNull();
    expect(b!.classList.contains('ai-pending')).toBe(false);
  });
});
