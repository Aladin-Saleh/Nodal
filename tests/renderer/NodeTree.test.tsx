// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
