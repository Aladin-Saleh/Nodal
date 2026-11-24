import { useCallback, useState } from 'react';

/** Déplacement par appui sur une flèche (px). */
const KEY_STEP = 16;

/** Taille d'un panneau (px) mémorisée sur ce poste ; `null` : par défaut. */
export function usePaneSize(storageKey: string) {
  const [size, setSize] = useState<number | null>(() => {
    try {
      const value = Number(localStorage.getItem(storageKey));
      return value > 0 ? value : null;
    } catch {
      return null;
    }
  });
  const save = useCallback(
    (value: number | null) => {
      setSize(value);
      try {
        if (value === null) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, String(value));
      } catch {
        // Taille non mémorisée.
      }
    },
    [storageKey],
  );
  return { size, setSize, save };
}

export interface ResizerProps {
  label: string;
  /** Bord du conteneur (élément parent) où commence le panneau redimensionné. */
  from: 'left' | 'right' | 'bottom';
  className?: string;
  /** Taille actuelle, annoncée aux lecteurs d'écran. */
  value: number;
  min: number;
  max(container: HTMLElement): number;
  onResize(size: number): void;
  /** Fin du geste : taille à mémoriser ; `null` : taille par défaut. */
  onSave(size: number | null): void;
}

/**
 * Séparateur à faire glisser (ou flèches du clavier) pour redimensionner un
 * panneau ; double-clic : taille par défaut.
 */
export function Resizer({
  label,
  from,
  className = '',
  value,
  min,
  max,
  onResize,
  onSave,
}: ResizerProps) {
  const vertical = from !== 'bottom';

  /** Taille affichée (peut être plus petite que celle demandée) et bornes. */
  const measure = (handle: HTMLElement) => {
    const container = handle.parentElement!;
    const box = container.getBoundingClientRect();
    const rect = handle.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const size = {
      left: x - box.left,
      right: box.right - x,
      bottom: box.bottom - y,
    }[from];
    const limit = Math.max(min, max(container));
    return {
      size,
      clamp: (next: number) => Math.round(Math.min(limit, Math.max(min, next))),
    };
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const { size, clamp } = measure(handle);
    const { clientX, clientY } = event;
    let next: number | null = null;
    handle.setPointerCapture(event.pointerId);
    const onMove = (move: PointerEvent) => {
      const delta = {
        left: move.clientX - clientX,
        right: clientX - move.clientX,
        bottom: clientY - move.clientY,
      }[from];
      if (next === null && delta === 0) return;
      next = clamp(size + delta);
      onResize(next);
    };
    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('lostpointercapture', onEnd);
      if (next !== null) onSave(next);
    };
    handle.addEventListener('pointermove', onMove);
    // Émis au relâchement comme à l'annulation du geste.
    handle.addEventListener('lostpointercapture', onEnd);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const [grow, shrink] = {
      left: ['ArrowRight', 'ArrowLeft'],
      right: ['ArrowLeft', 'ArrowRight'],
      bottom: ['ArrowUp', 'ArrowDown'],
    }[from];
    if (event.key !== grow && event.key !== shrink) return;
    event.preventDefault();
    event.stopPropagation();
    const { size, clamp } = measure(event.currentTarget);
    onSave(clamp(size + (event.key === grow ? KEY_STEP : -KEY_STEP)));
  };

  return (
    <div
      className={`resizer ${vertical ? 'resizer-x' : 'resizer-y'} ${className}`}
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      title="Glisser pour redimensionner, double-clic pour rétablir"
      onPointerDown={startDrag}
      onDoubleClick={() => onSave(null)}
      onKeyDown={onKeyDown}
    />
  );
}
