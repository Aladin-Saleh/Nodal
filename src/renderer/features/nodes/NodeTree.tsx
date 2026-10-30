import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import { NODE_TYPE_LABELS } from '../../../shared/domain';
import {
  dropMove,
  visibleRows,
  type DropMove,
  type DropPosition,
  type TreeIndex,
} from './tree';

/** Type de donnée glissée : un nœud de l'arborescence. */
const DRAG_TYPE = 'application/x-nodal-node';

/** Quart haut : avant ; quart bas : après ; milieu : dans le nœud. */
function dropPositionAt(event: DragEvent<HTMLElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
  return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
}

export interface NodeTreeProps {
  index: TreeIndex;
  expanded: ReadonlySet<string>;
  selectedId: string | null;
  onSelect(id: string): void;
  onToggle(id: string, expanded: boolean): void;
  onDelete(id: string): void;
  onRename(id: string): void;
  /** Nœuds trouvés par la recherche, mis en évidence. */
  highlighted?: ReadonlySet<string> | null;
  /** Sélection multiple (Ctrl+clic). */
  multiSelection?: ReadonlySet<string>;
  onToggleMulti?(id: string): void;
  /** Œil : nœuds masqués dans le graphe (bouton enfoncé). */
  hidden?: ReadonlySet<string>;
  /** Nœuds absents du graphe (masqués, sous un nœud masqué, hors solo) : grisés. */
  masked?: ReadonlySet<string>;
  /** Branche affichée seule dans le graphe. */
  solo?: string | null;
  /** Clic sur l'œil ou touche H : masquer / afficher dans le graphe. */
  onToggleHidden?(id: string): void;
  /** Alt+clic sur l'œil : n'afficher que cette branche (ou quitter le solo). */
  onToggleSolo?(id: string): void;
  /** Glisser-déposer : déplacer le nœud (changer de parent ou de rang). */
  onMove?(id: string, move: DropMove): void;
  /** Clic droit, touche Menu ou Maj+F10 : menu contextuel du nœud. */
  onContextMenu?(id: string, point: { x: number; y: number }): void;
}

/** Œil ouvert, ou barré quand le nœud est masqué. */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      {crossed && (
        <path d="M2.5 13.5 13.5 2.5" stroke="currentColor" strokeWidth="1.5" />
      )}
    </svg>
  );
}

/**
 * Arborescence des nœuds (§7), navigable au clavier selon le motif ARIA
 * « tree » : flèches haut/bas, droite (déplier / premier enfant), gauche
 * (replier / parent), Début/Fin, Suppr, F2, H (masquer dans le graphe) et
 * Menu ou Maj+F10 (menu contextuel). Les nœuds se déplacent aussi par
 * glisser-déposer : avant, après ou dans un autre nœud.
 */
export function NodeTree({
  index,
  expanded,
  selectedId,
  onSelect,
  onToggle,
  onDelete,
  onRename,
  highlighted = null,
  multiSelection,
  onToggleMulti,
  hidden,
  masked,
  solo = null,
  onToggleHidden,
  onToggleSolo,
  onMove,
  onContextMenu,
}: NodeTreeProps) {
  const rows = visibleRows(index, expanded);
  const container = useRef<HTMLUListElement>(null);
  const focusOnSelect = useRef(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{
    id: string;
    position: DropPosition;
  } | null>(null);

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
      case 'ContextMenu':
      case 'F10': {
        if (event.key === 'F10' && !event.shiftKey) return;
        if (!current || !onContextMenu) return;
        const row = (event.target as HTMLElement).closest('[data-node-id]');
        const rect = row?.getBoundingClientRect();
        onContextMenu(current.node.id, {
          x: (rect?.left ?? 0) + 24,
          y: rect?.bottom ?? 0,
        });
        break;
      }
      case 'h':
      case 'H':
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (!current || !onToggleHidden) return;
        onToggleHidden(current.node.id);
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
        const isHidden = !!hidden?.has(row.node.id);
        const isSolo = solo === row.node.id;
        const hint = dropHint?.id === row.node.id ? dropHint.position : null;
        return (
          <li
            key={row.node.id}
            role="treeitem"
            data-node-id={row.node.id}
            aria-level={row.depth + 1}
            aria-selected={selected}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            tabIndex={tabbable ? 0 : -1}
            className={[
              'tree-row',
              selected ? 'selected' : '',
              highlighted?.has(row.node.id) ? 'search-match' : '',
              multiSelection?.has(row.node.id) ? 'multi-selected' : '',
              masked?.has(row.node.id) ? 'masked' : '',
              row.node.assistantPending ? 'ai-pending' : '',
              isHidden || isSolo ? 'eye-active' : '',
              hint ? `drop-${hint}` : '',
              dragged === row.node.id ? 'dragging' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: `${row.depth * 16 + 4}px` }}
            draggable={!!onMove}
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TYPE, row.node.id);
              event.dataTransfer.effectAllowed = 'move';
              setDragged(row.node.id);
            }}
            onDragOver={(event) => {
              if (!dragged || !onMove) return;
              const place = dropPositionAt(event);
              // Cible interdite (descendant) ou sans effet : pas de dépôt.
              if (!dropMove(index, dragged, row.node.id, place)) {
                if (hint) setDropHint(null);
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (hint !== place)
                setDropHint({ id: row.node.id, position: place });
            }}
            onDragLeave={(event) => {
              if (
                hint &&
                !event.currentTarget.contains(event.relatedTarget as Node)
              ) {
                setDropHint(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = dragged ?? event.dataTransfer.getData(DRAG_TYPE);
              setDragged(null);
              setDropHint(null);
              if (!id || !onMove) return;
              const drop = dropMove(
                index,
                id,
                row.node.id,
                dropPositionAt(event),
              );
              if (drop) onMove(id, drop);
            }}
            onDragEnd={() => {
              setDragged(null);
              setDropHint(null);
            }}
            onContextMenu={(event) => {
              if (!onContextMenu) return;
              event.preventDefault();
              onSelect(row.node.id);
              onContextMenu(row.node.id, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onClick={(event) => {
              if ((event.ctrlKey || event.metaKey) && onToggleMulti) {
                onToggleMulti(row.node.id);
              } else {
                onSelect(row.node.id);
              }
            }}
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
            {row.node.assistantPending && (
              <span
                className="ai-mark"
                title="Ajouté par l’IA, non validé"
                aria-label="Ajouté par l’IA, non validé"
              >
                IA
              </span>
            )}
            {onToggleHidden && (
              <button
                type="button"
                className={isSolo ? 'tree-eye solo' : 'tree-eye'}
                // Hors de la tabulation de l'arbre (une seule entrée) : la
                // touche H fait la même chose au clavier.
                tabIndex={-1}
                aria-pressed={isHidden}
                aria-label={
                  isHidden
                    ? 'Afficher dans le graphe'
                    : 'Masquer dans le graphe'
                }
                title={
                  (isHidden
                    ? 'Afficher dans le graphe (H)'
                    : 'Masquer dans le graphe (H)') +
                  (isSolo
                    ? ' · Alt+clic : quitter le solo'
                    : ' · Alt+clic : n’afficher que cette branche')
                }
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.altKey && onToggleSolo) onToggleSolo(row.node.id);
                  else onToggleHidden(row.node.id);
                }}
              >
                <EyeIcon crossed={isHidden} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
