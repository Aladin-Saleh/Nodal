import { useRef, useState, type ReactNode } from 'react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

export interface MenuButtonProps {
  /** Contenu du bouton (texte, « ⋯ »…). */
  children: ReactNode;
  /** Nom du menu ; aussi celui du bouton sans flèche (bouton icône « ⋯ »). */
  label: string;
  items: readonly ContextMenuItem[];
  /** Classe du bouton (par défaut `secondary`). */
  className?: string;
  /** Aligne le menu sur le bord droit du bouton. */
  alignRight?: boolean;
  disabled?: boolean;
  title?: string;
  /** Flèche « ▾ » après le texte (pas pour un bouton icône « ⋯ »). */
  caret?: boolean;
  /** Appelé à l'ouverture (ex. relire une liste). */
  onOpen?(): void;
}

/**
 * Bouton qui ouvre un menu (motif ARIA « menu button ») : même menu que le
 * clic droit, placé sous le bouton. Clic ou Flèche bas pour ouvrir ; le focus
 * revient au bouton à la fermeture.
 */
export function MenuButton({
  children,
  label,
  items,
  className = 'secondary',
  alignRight = false,
  disabled = false,
  title,
  caret = true,
  onOpen,
}: MenuButtonProps) {
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  const open = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    onOpen?.();
    setPosition({ x: alignRight ? rect.right : rect.left, y: rect.bottom + 4 });
  };
  const close = () => {
    setPosition(null);
    button.current?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`menu-button ${className}`}
        aria-haspopup="menu"
        aria-expanded={position !== null}
        aria-label={caret ? undefined : label}
        title={title}
        disabled={disabled}
        onClick={() => (position ? close() : open())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !position) {
            event.preventDefault();
            open();
          }
        }}
      >
        {children}
        {caret && (
          <span className="menu-caret" aria-hidden="true">
            ▾
          </span>
        )}
      </button>
      {position && (
        <ContextMenu
          x={position.x}
          y={position.y}
          label={label}
          items={items}
          ignore={button}
          alignRight={alignRight}
          onClose={close}
        />
      )}
    </>
  );
}
