import type { CSSProperties, ReactNode } from 'react';
import { Resizer, usePaneSize } from '../../components/Resizer';

/** Même valeur dans `.editor-panes.mode-split` (graph.css). */
const MIN_PANE = 160;
const GAP = 12;

/** Éditeur et aperçu ; côte à côte, un bord à faire glisser les sépare. */
export function EditorPanes({
  mode,
  editor,
  preview,
}: {
  mode: 'edit' | 'split' | 'preview';
  editor: ReactNode;
  preview: ReactNode;
}) {
  const { size, setSize, save } = usePaneSize('nodal.editor.width');
  return (
    <div
      className={`editor-panes mode-${mode}`}
      style={
        size === null
          ? undefined
          : ({ '--editor-width': `${size}px` } as CSSProperties)
      }
    >
      {mode !== 'preview' && editor}
      {mode !== 'edit' && preview}
      {mode === 'split' && (
        <Resizer
          label="Redimensionner l’éditeur et l’aperçu"
          from="left"
          className="editor-resizer"
          value={size ?? MIN_PANE}
          min={MIN_PANE}
          max={(panes) => panes.clientWidth - MIN_PANE - GAP}
          onResize={(width) => setSize(width)}
          onSave={save}
        />
      )}
    </div>
  );
}
