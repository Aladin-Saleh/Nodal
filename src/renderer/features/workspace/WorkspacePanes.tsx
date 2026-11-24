import type { CSSProperties, ReactNode } from 'react';
import { Resizer, usePaneSize } from '../../components/Resizer';

const DEFAULT_TREE = 280;
const DEFAULT_RIGHT = 320;
/** Largeurs minimales (px) ; mêmes valeurs dans `.panes` (workspace.css). */
const MIN_TREE = 160;
const MIN_CENTER = 240;
const MIN_RIGHT = 200;

const widthOf = (container: HTMLElement, selector: string) =>
  container.querySelector<HTMLElement>(selector)?.offsetWidth ?? 0;

/**
 * Arborescence, zone centrale et panneau droit, séparés par des bords à faire
 * glisser. Les panneaux, passés en `children`, ne sont pas recalculés pendant
 * le geste.
 */
export function WorkspacePanes({
  hasRight,
  children,
}: {
  hasRight: boolean;
  children: ReactNode;
}) {
  const tree = usePaneSize('nodal.tree.width');
  const right = usePaneSize('nodal.properties.width');
  const treeWidth = tree.size ?? DEFAULT_TREE;
  const rightWidth = right.size ?? DEFAULT_RIGHT;
  return (
    <div
      className={hasRight ? 'panes' : 'panes no-properties'}
      style={
        {
          '--tree-width': `${treeWidth}px`,
          '--right-width': `${rightWidth}px`,
        } as CSSProperties
      }
    >
      {children}
      <Resizer
        label="Redimensionner l’arborescence"
        from="left"
        className="tree-resizer"
        value={treeWidth}
        min={MIN_TREE}
        max={(panes) =>
          panes.clientWidth - MIN_CENTER - widthOf(panes, '.right-pane')
        }
        onResize={tree.setSize}
        onSave={tree.save}
      />
      {hasRight && (
        <Resizer
          label="Redimensionner le panneau du nœud"
          from="right"
          className="right-resizer"
          value={rightWidth}
          min={MIN_RIGHT}
          max={(panes) =>
            panes.clientWidth - MIN_CENTER - widthOf(panes, '.tree-pane')
          }
          onResize={right.setSize}
          onSave={right.save}
        />
      )}
    </div>
  );
}
