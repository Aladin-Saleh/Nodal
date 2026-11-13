// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuButton } from '../../src/renderer/components/MenuButton';
import {
  MENU_SEPARATOR,
  menuItems,
  type AppAction,
} from '../../src/renderer/features/commands/actions';

afterEach(cleanup);

const action = (id: string, label: string, extra: Partial<AppAction> = {}) =>
  ({
    id,
    label,
    group: 'Espace',
    enabled: true,
    run: vi.fn(),
    ...extra,
  }) satisfies AppAction;

describe('menuItems', () => {
  const actions = [
    action('a', 'Tags…', { shortcuts: [{ key: 't', ctrl: true }] }),
    action('b', 'Indisponible', { enabled: false }),
    action('c', 'Fermer'),
  ];

  it('suit l’ordre du gabarit, avec séparateurs et raccourcis', () => {
    const items = menuItems(
      actions,
      ['a', MENU_SEPARATOR, 'b', 'inconnu', 'c'],
      {
        danger: ['c'],
      },
    );
    expect(items.map((item) => item.label)).toEqual([
      'Tags…',
      'Indisponible',
      'Fermer',
    ]);
    expect(items[0]).toMatchObject({ shortcut: 'Ctrl + T', separator: false });
    expect(items[1]).toMatchObject({ disabled: true, separator: true });
    expect(items[2]).toMatchObject({ danger: true, separator: false });
  });

  it('omet les actions inactives sur demande, sans séparateur en tête', () => {
    const items = menuItems(actions, ['b', MENU_SEPARATOR, 'c'], {
      omitDisabled: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: 'Fermer', separator: false });
  });
});

describe('MenuButton', () => {
  function setup() {
    const onSelect = vi.fn();
    render(
      <MenuButton label="Espace" items={[{ label: 'Tags…', onSelect }]}>
        Espace
      </MenuButton>,
    );
    return { onSelect, button: screen.getByRole('button', { name: 'Espace' }) };
  }

  it('ouvre le menu au clic, choisit puis rend le focus au bouton', () => {
    const { onSelect, button } = setup();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const item = screen.getByRole('menuitem', { name: 'Tags…' });
    expect(document.activeElement).toBe(item);
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Flèche bas ouvre, Échap ferme, un second clic referme', () => {
    const { button } = setup();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(button);
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
