import { useMemo, useState } from 'react';
import { ContextMenu } from '../../components/ContextMenu';
import { maskedNodeIds } from '../graph/graph-model';
import { NodeTree } from '../nodes/NodeTree';
import { siblingsOf, type DropMove, type TreeIndex } from '../nodes/tree';
import { useViewDispatch, useViewState } from './view-state-context';

export interface TreePaneProps {
  index: TreeIndex;
  /** Nœuds trouvés par la recherche, mis en évidence. */
  searchMatches: ReadonlySet<string> | null;
  onSelect(id: string): void;
  onNew(parentId: string | null): void;
  /** Déplace le nœud sélectionné d'un rang parmi ses frères. */
  onShift(offset: -1 | 1): void;
  onDelete(id: string): void;
  onRename(id: string): void;
  /** Glisser-déposer : nouveau parent et rang. */
  onMove(id: string, move: DropMove): void;
  onAddDocument(id: string): void;
  /** Sélectionne le nœud et le centre dans la vue graphe. */
  onCenter(id: string): void;
}

/** Remet le focus sur la ligne d'un nœud (après le menu contextuel). */
function focusRow(id: string) {
  document
    .querySelector<HTMLElement>(`.tree [data-node-id="${CSS.escape(id)}"]`)
    ?.focus();
}

/** Panneau gauche : actions sur les nœuds et arborescence. */
export function TreePane({
  index,
  searchMatches,
  onSelect,
  onNew,
  onShift,
  onDelete,
  onRename,
  onMove,
  onAddDocument,
  onCenter,
}: TreePaneProps) {
  const [menu, setMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const {
    selectedId,
    expanded,
    multiSelection,
    graph: { hidden, solo },
  } = useViewState();
  const dispatch = useViewDispatch();
  // Lignes grisées : nœuds absents du graphe à cause de l'œil.
  const masked = useMemo(
    () => maskedNodeIds([...index.byId.values()], { hidden, solo }),
    [index, hidden, solo],
  );
  const selected = selectedId ? (index.byId.get(selectedId) ?? null) : null;
  const siblings = selected ? siblingsOf(index, selected) : [];
  const siblingPosition = selected
    ? siblings.findIndex((sibling) => sibling.id === selected.id)
    : -1;

  return (
    <nav className="tree-pane" aria-label="Navigation">
      <div className="toolbar" aria-label="Actions sur les nœuds">
        <button
          type="button"
          title="Nouveau nœud racine (Ctrl+Maj+N)"
          onClick={() => onNew(null)}
        >
          + Racine
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!selected}
          title="Nouveau sous-nœud (Ctrl+N)"
          onClick={() => onNew(selectedId)}
        >
          + Enfant
        </button>
        <button
          type="button"
          className="secondary"
          disabled={siblingPosition <= 0}
          aria-label="Monter le nœud"
          title="Monter"
          onClick={() => onShift(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="secondary"
          disabled={
            siblingPosition === -1 || siblingPosition === siblings.length - 1
          }
          aria-label="Descendre le nœud"
          title="Descendre"
          onClick={() => onShift(1)}
        >
          ↓
        </button>
      </div>
      <NodeTree
        index={index}
        expanded={expanded}
        selectedId={selectedId}
        onSelect={onSelect}
        onToggle={(id, open) => dispatch({ type: 'setExpanded', id, open })}
        onDelete={onDelete}
        onRename={onRename}
        onMove={onMove}
        onContextMenu={(id, point) => setMenu({ id, ...point })}
        highlighted={searchMatches}
        multiSelection={multiSelection}
        onToggleMulti={(id) => dispatch({ type: 'toggleMulti', id })}
        hidden={hidden}
        masked={masked}
        solo={solo}
        onToggleHidden={(id) => dispatch({ type: 'toggleHidden', id })}
        onToggleSolo={(id) => dispatch({ type: 'toggleSolo', id })}
      />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`Actions sur « ${index.byId.get(menu.id)?.title ?? ''} »`}
          onClose={() => {
            setMenu(null);
            focusRow(menu.id);
          }}
          items={[
            { label: 'Nouveau sous-nœud', onSelect: () => onNew(menu.id) },
            { label: 'Renommer', onSelect: () => onRename(menu.id) },
            {
              label: hidden.has(menu.id)
                ? 'Afficher dans le graphe'
                : 'Masquer dans le graphe',
              onSelect: () => dispatch({ type: 'toggleHidden', id: menu.id }),
            },
            {
              label: 'Centrer dans le graphe',
              onSelect: () => onCenter(menu.id),
            },
            {
              label: 'Ajouter un document',
              onSelect: () => onAddDocument(menu.id),
            },
            {
              label: 'Supprimer…',
              danger: true,
              onSelect: () => onDelete(menu.id),
            },
          ]}
        />
      )}
    </nav>
  );
}
