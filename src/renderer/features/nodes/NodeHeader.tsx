import { useEffect, useId, useRef, useState } from 'react';
import { NODE_TYPE_LABELS, TITLE_MAX_LENGTH } from '../../../shared/domain';
import type { NodeDetail } from '../../../shared/model';
import type { ContextMenuItem } from '../../components/ContextMenu';
import { MenuButton } from '../../components/MenuButton';
import { AssistantBadge } from '../workspace/AssistantBadge';

export interface NodeHeaderProps {
  node: NodeDetail;
  /** Renommer (F2, menu, palette) : le titre reçoit le focus, sélectionné. */
  focusTitle?: boolean;
  onTitleFocused?(): void;
  onNavigate(id: string): void;
  /** Retourne `true` si le renommage a réussi. */
  onRename(title: string): Promise<boolean>;
  /** Actions du nœud (même menu que le clic droit dans l'arbre). */
  menu: readonly ContextMenuItem[];
  /** Valider un nœud ajouté par l'IA. */
  onValidate?(): void;
}

/** Chemin hiérarchique (§6.2), titre éditable et actions du nœud courant. */
export function NodeHeader({
  node,
  focusTitle = false,
  onTitleFocused,
  onNavigate,
  onRename,
  menu,
  onValidate,
}: NodeHeaderProps) {
  const titleId = useId();
  const [title, setTitle] = useState(node.title);
  const titleInput = useRef<HTMLInputElement>(null);
  const focused = useRef(onTitleFocused);
  useEffect(() => {
    focused.current = onTitleFocused;
  });
  useEffect(() => {
    if (!focusTitle) return;
    titleInput.current?.focus();
    titleInput.current?.select();
    focused.current?.();
  }, [focusTitle]);

  const commit = async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === node.title) {
      setTitle(node.title);
      return;
    }
    if (!(await onRename(trimmed))) setTitle(node.title);
  };

  return (
    <header className="node-header">
      <nav aria-label="Chemin du nœud">
        <ol className="breadcrumb">
          {node.path.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="link-button"
                onClick={() => onNavigate(item.id)}
              >
                {item.title}
              </button>
            </li>
          ))}
          <li aria-current="page">{node.title}</li>
        </ol>
      </nav>
      <div className="node-title-row">
        <label htmlFor={titleId} className="visually-hidden">
          Titre du nœud
        </label>
        <input
          id={titleId}
          ref={titleInput}
          className="node-title"
          type="text"
          value={title}
          maxLength={TITLE_MAX_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setTitle(node.title);
              event.currentTarget.blur();
            }
          }}
        />
        <span className={`badge type-${node.nodeType}`}>
          {NODE_TYPE_LABELS[node.nodeType]}
        </span>
        <AssistantBadge origin={node.createdByAssistant} what="Nœud créé" />
        {node.createdByAssistant && onValidate && (
          <button
            type="button"
            className="secondary"
            title="Marquer ce nœud comme vérifié : il n’est plus signalé comme ajouté par l’IA"
            onClick={onValidate}
          >
            Valider
          </button>
        )}
        <MenuButton
          label={`Actions sur « ${node.title} »`}
          className="secondary icon-button"
          caret={false}
          alignRight
          title="Actions du nœud"
          items={menu}
        >
          ⋯
        </MenuButton>
      </div>
    </header>
  );
}
