import { NodeTree } from '../nodes/NodeTree';
import { siblingsOf, type TreeIndex } from '../nodes/tree';
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
  onRename(): void;
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
}: TreePaneProps) {
  const { selectedId, expanded, multiSelection } = useViewState();
  const dispatch = useViewDispatch();
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
        highlighted={searchMatches}
        multiSelection={multiSelection}
        onToggleMulti={(id) => dispatch({ type: 'toggleMulti', id })}
      />
    </nav>
  );
}
