import { useEffect, useRef, type KeyboardEvent } from 'react';
import { NODE_TYPE_LABELS } from '../../../shared/domain';
import { visibleRows, type TreeIndex } from './tree';

export interface NodeTreeProps {
  index: TreeIndex;
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  onSelect(id: string): void;
  onToggle(id: string, expanded: boolean): void;
  onDelete(id: string): void;
  onRename(id: string): void;
}

/**
 * Arborescence des nœuds (§7), navigable au clavier selon le motif ARIA
 * « tree » : flèches haut/bas, droite (déplier / premier enfant), gauche
 * (replier / parent), Début/Fin, Suppr et F2.
 */
export function NodeTree({
  index,
  expanded,
  selectedId,
  onSelect,
  onToggle,
  onDelete,
  onRename,
}: NodeTreeProps) {
  const rows = visibleRows(index, expanded);
  const container = useRef<HTMLUListElement>(null);
  const focusOnSelect = useRef(false);

  useEffect(() => {
    if (!focusOnSelect.current || !selectedId) return;
    focusOnSelect.current = false;
    [
      ...(container.current?.querySelectorAll<HTMLElement>('[data-node-id]') ??
        []),
    ]
      .find((element) => element.dataset.nodeId === selectedId)
      ?.focus();
  }, [selectedId]);

  if (rows.length === 0) {
    return (
      <p className="muted empty-state">
        Aucun nœud. Créez un premier nœud racine pour commencer.
      </p>
    );
  }

  const position = rows.findIndex((row) => row.node.id === selectedId);
  const move = (id: string | undefined) => {
    if (!id) return;
    focusOnSelect.current = true;
    onSelect(id);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const current = rows[position];
    switch (event.key) {
      case 'ArrowDown':
        move(rows[Math.min(position + 1, rows.length - 1)]?.node.id);
        break;
      case 'ArrowUp':
        move(rows[Math.max(position - 1, 0)]?.node.id);
        break;
      case 'Home':
        move(rows[0]?.node.id);
        break;
      case 'End':
        move(rows.at(-1)?.node.id);
        break;
      case 'ArrowRight':
        if (!current?.hasChildren) return;
        if (!current.expanded) onToggle(current.node.id, true);
        else move(rows[position + 1]?.node.id);
        break;
      case 'ArrowLeft':
        if (!current) return;
        if (current.expanded) onToggle(current.node.id, false);
        else move(current.node.parentId ?? undefined);
        break;
      case 'Delete':
        if (current) onDelete(current.node.id);
        break;
      case 'F2':
        if (current) onRename(current.node.id);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <ul
      ref={container}
      className="tree"
      role="tree"
      aria-label="Arborescence des nœuds"
      onKeyDown={onKeyDown}
    >
      {rows.map((row, rowIndex) => {
        const selected = row.node.id === selectedId;
        // Tabulation itinérante : un seul élément focalisable.
        const tabbable = selected || (position === -1 && rowIndex === 0);
        return (
          <li
            key={row.node.id}
            role="treeitem"
            data-node-id={row.node.id}
            aria-level={row.depth + 1}
            aria-selected={selected}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            tabIndex={tabbable ? 0 : -1}
            className={selected ? 'tree-row selected' : 'tree-row'}
            style={{ paddingLeft: `${row.depth * 16 + 4}px` }}
            onClick={() => onSelect(row.node.id)}
          >
            <span
              className="tree-toggle"
              aria-hidden="true"
              onClick={(event) => {
                if (!row.hasChildren) return;
                event.stopPropagation();
                onToggle(row.node.id, !row.expanded);
              }}
            >
              {row.hasChildren ? (row.expanded ? '▾' : '▸') : ''}
            </span>
            <span
              className={`type-dot type-${row.node.nodeType}`}
              style={
                row.node.color ? { background: row.node.color } : undefined
              }
              title={NODE_TYPE_LABELS[row.node.nodeType]}
              aria-hidden="true"
            />
            <span className="tree-title">{row.node.title}</span>
          </li>
        );
      })}
    </ul>
  );
}
