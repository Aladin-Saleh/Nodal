import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type RefObject,
} from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect(): void;
  disabled?: boolean;
  /** Action destructrice (affichée en rouge). */
  danger?: boolean;
  /** Raccourci clavier, affiché à droite. */
  shortcut?: string;
  /** Trait de séparation avant l'élément (début d'un groupe). */
  separator?: boolean;
  /** Infobulle (ex. chemin complet). */
  title?: string;
}

export interface ContextMenuProps {
  /** Position du coin haut-gauche, en pixels dans la fenêtre. */
  x: number;
  y: number;
  label: string;
  items: readonly ContextMenuItem[];
  onClose(): void;
  /** Élément dont un clic ne ferme pas le menu (son bouton d'ouverture). */
  ignore?: RefObject<HTMLElement | null>;
  /** `x` désigne le bord droit du menu (menu ouvert sous un bouton à droite). */
  alignRight?: boolean;
}

/**
 * Menu contextuel (motif ARIA « menu ») : le premier élément actif reçoit le
 * focus ; flèches haut/bas, Début/Fin pour se déplacer, Entrée pour choisir,
 * Échap ou clic à l'extérieur pour fermer. Reste dans la fenêtre.
 */
export function ContextMenu({
  x,
  y,
  label,
  items,
  onClose,
  ignore,
  alignRight = false,
}: ContextMenuProps) {
  const menu = useRef<HTMLUListElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  const buttons = () => [
    ...(menu.current?.querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    ) ?? []),
  ];

  // Placement dans la fenêtre, puis focus sur le premier élément.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const left = alignRight ? x - width : x;
    element.style.left = `${Math.max(0, Math.min(left, window.innerWidth - width - 4))}px`;
    element.style.top = `${Math.max(0, Math.min(y, window.innerHeight - height - 4))}px`;
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y, alignRight]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || ignore?.current?.contains(target))
        return;
      close.current();
    };
    const onBlur = () => close.current();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [ignore]);

  const onKeyDown = (event: KeyboardEvent) => {
    const list = buttons();
    const current = list.indexOf(document.activeElement as HTMLButtonElement);
    const focus = (index: number) =>
      list[(index + list.length) % list.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        focus(current + 1);
        break;
      case 'ArrowUp':
        focus(current - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(list.length - 1);
        break;
      case 'Escape':
      case 'Tab':
        onClose();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <ul
      ref={menu}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <li
          key={item.label}
          role="none"
          className={item.separator ? 'menu-separated' : undefined}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={item.danger ? 'danger-text' : undefined}
            title={item.title}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <kbd className="menu-shortcut" aria-hidden="true">
                {item.shortcut}
              </kbd>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
