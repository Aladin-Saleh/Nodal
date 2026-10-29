import { useId, useState, type RefObject } from 'react';
import { NODE_TYPE_LABELS, TITLE_MAX_LENGTH } from '../../../shared/domain';
import type { NodeDetail } from '../../../shared/model';

export interface NodeHeaderProps {
  node: NodeDetail;
  titleInput: RefObject<HTMLInputElement | null>;
  onNavigate(id: string): void;
  /** Retourne `true` si le renommage a réussi. */
  onRename(title: string): Promise<boolean>;
  onMove(): void;
  onDuplicate(): void;
  onDelete(): void;
}

/** Chemin hiérarchique (§6.2), titre éditable et actions du nœud courant. */
export function NodeHeader({
  node,
  titleInput,
  onNavigate,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
}: NodeHeaderProps) {
  const titleId = useId();
  const [title, setTitle] = useState(node.title);

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
        <div className="node-actions">
          <button type="button" className="secondary" onClick={onMove}>
            Déplacer…
          </button>
          <button type="button" className="secondary" onClick={onDuplicate}>
            Dupliquer…
          </button>
          <button
            type="button"
            className="secondary danger-text"
            onClick={onDelete}
          >
            Supprimer…
          </button>
        </div>
      </div>
    </header>
  );
}
