import { useMemo, useState } from 'react';
import { ContextMenu } from '../../components/ContextMenu';
import type { AppAction } from '../commands/actions';
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
  /** Actions du nœud (registre commun) : menu contextuel. */
  actionsForNode(id: string): AppAction[];
  /** Nœuds à la documentation possiblement obsolète. */
  stale?: ReadonlySet<string>;
}

/** Actions du menu contextuel, dans cet ordre (les inactives sont omises). */
const CONTEXT_MENU_ACTIONS = [
  'node.newChild',
  'node.rename',
  'node.toggleHidden',
  'node.solo',
  'node.center',
  'node.pathTo',
  'node.validate',
  'node.addDocument',
  'node.move',
  'node.duplicate',
  'node.delete',
];

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
  actionsForNode,
  stale,
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
        stale={stale}
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
          items={CONTEXT_MENU_ACTIONS.flatMap((actionId) => {
            const action = actionsForNode(menu.id).find(
              (candidate) => candidate.id === actionId,
            );
            return action?.enabled
              ? [
                  {
                    label: action.label,
                    danger: action.id === 'node.delete',
                    onSelect: action.run,
                  },
                ]
              : [];
          })}
        />
      )}
    </nav>
  );
}
