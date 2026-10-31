import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  paletteItems,
  shortcutLabel,
  type AppAction,
  type PaletteItem,
  type PaletteNode,
} from './actions';

export interface CommandPaletteProps {
  actions: readonly AppAction[];
  nodes: readonly PaletteNode[];
  /** Proposés quand la requête est vide (historique de navigation). */
  recentNodes?: readonly PaletteNode[];
  /** Ctrl+Maj+P : actions seulement. Un « > » en tête de requête aussi. */
  actionsOnly: boolean;
  onOpenNode(id: string): void;
  onClose(): void;
  /** Libellé du champ (autre usage que « aller à », ex. choisir une cible). */
  label?: string;
  placeholder?: string;
}

const itemKey = (item: PaletteItem) =>
  item.kind === 'action' ? `a:${item.action.id}` : `n:${item.node.id}`;

/**
 * Palette de commandes (Ctrl+P) : cherche à la fois les nœuds (titre et
 * chemin) et les actions de l'application. Motif ARIA combobox + listbox :
 * le focus reste dans le champ, l'option active est indiquée par
 * `aria-activedescendant`.
 */
export function CommandPalette({
  actions,
  nodes,
  recentNodes,
  actionsOnly,
  onOpenNode,
  onClose,
  label = 'Aller à un nœud ou lancer une action',
  placeholder,
}: CommandPaletteProps) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState(actionsOnly ? '>' : '');
  const [active, setActive] = useState(0);

  const onlyActions = query.startsWith('>');
  const items = useMemo(
    () =>
      paletteItems(onlyActions ? query.slice(1) : query, actions, nodes, {
        actionsOnly: onlyActions,
        recentNodes,
      }),
    [actions, nodes, recentNodes, onlyActions, query],
  );
  const current = Math.min(active, Math.max(items.length - 1, 0));

  // Focus dans le champ à l'ouverture, rendu à l'élément précédent ensuite.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [current]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === 'node') onOpenNode(item.node.id);
    // Après la fermeture : l'action peut ouvrir une autre fenêtre.
    else setTimeout(() => item.action.run(), 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = items.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(current + 1, last),
      ArrowUp: Math.max(current - 1, 0),
      PageDown: Math.min(current + 8, last),
      PageUp: Math.max(current - 8, 0),
    };
    if (event.key in moves) {
      event.preventDefault();
      setActive(moves[event.key]!);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[current]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === 'Tab') {
      // Rien d'autre à atteindre : le focus reste dans la palette.
      event.preventDefault();
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={onClose}>
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            items.length > 0 ? `${listId}-${current}` : undefined
          }
          placeholder={
            placeholder ??
            (onlyActions
              ? 'Action…'
              : 'Nœud ou action… (« > » pour les actions seules)')
          }
          value={query}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {items.length === 0 ? (
          <p className="palette-empty muted" role="status">
            Aucun résultat.
          </p>
        ) : (
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-label="Propositions"
            className="palette-list"
          >
            {items.map((item, index) => (
              <li
                key={itemKey(item)}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === current}
                className={index === current ? 'active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(item)}
              >
                {item.kind === 'node' ? (
                  <>
                    <span className="palette-kind">Nœud</span>
                    <span className="palette-label">{item.node.title}</span>
                    {item.node.path && (
                      <span className="palette-detail muted">
                        {item.node.path}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="palette-kind">{item.action.group}</span>
                    <span className="palette-label">{item.action.label}</span>
                    {shortcutLabel(item.action) && (
                      <kbd className="palette-detail">
                        {shortcutLabel(item.action)}
                      </kbd>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
