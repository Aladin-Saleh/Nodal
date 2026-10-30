// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu } from '../../src/renderer/components/ContextMenu';

afterEach(cleanup);

function renderMenu() {
  const actions = { rename: vi.fn(), remove: vi.fn(), hidden: vi.fn() };
  const onClose = vi.fn();
  render(
    <ContextMenu
      x={10}
      y={10}
      label="Actions sur « A »"
      onClose={onClose}
      items={[
        { label: 'Renommer', onSelect: actions.rename },
        { label: 'Indisponible', onSelect: actions.hidden, disabled: true },
        { label: 'Supprimer…', onSelect: actions.remove, danger: true },
      ]}
    />,
  );
  return { actions, onClose };
}

describe('ContextMenu', () => {
  it('donne le focus au premier élément et se parcourt aux flèches', () => {
    renderMenu();
    const menu = screen.getByRole('menu', { name: 'Actions sur « A »' });
    expect(document.activeElement?.textContent).toBe('Renommer');
    // L'élément désactivé est sauté ; le parcours boucle.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Supprimer…');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Renommer');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Supprimer…');
  });

  it('choisit une action puis se ferme', () => {
    const { actions, onClose } = renderMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Supprimer…' }));
    expect(actions.remove).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('se ferme avec Échap ou un clic à l’extérieur', () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
