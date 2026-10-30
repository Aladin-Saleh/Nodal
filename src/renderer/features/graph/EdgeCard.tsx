import type { EdgeInfo, RelationTypeInfo } from '../../../shared/model';

export interface EdgeCardProps {
  edge: EdgeInfo;
  relationType: RelationTypeInfo | undefined;
  sourceTitle: string;
  targetTitle: string;
  /** Sélectionne l'une des extrémités dans le graphe. */
  onNavigate(nodeId: string): void;
  onEdit(): void;
  onDelete(): void;
  onClose(): void;
}

/**
 * Fiche d'une relation cliquée dans le graphe : extrémités, type, libellé et
 * description, avec modification et suppression.
 */
export function EdgeCard({
  edge,
  relationType,
  sourceTitle,
  targetTitle,
  onNavigate,
  onEdit,
  onDelete,
  onClose,
}: EdgeCardProps) {
  const typeName = relationType?.name ?? 'Relation';
  return (
    <aside className="edge-card" aria-label="Relation sélectionnée">
      <header className="edge-card-header">
        <span className="edge-card-type">
          <span
            className="edge-card-swatch"
            style={
              relationType?.color
                ? { background: relationType.color }
                : undefined
            }
            aria-hidden="true"
          />
          {typeName}
        </span>
        <button
          type="button"
          className="link-button"
          aria-label="Fermer la fiche de la relation"
          title="Fermer (Échap)"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p className="edge-card-ends">
        <button
          type="button"
          className="link-button"
          onClick={() => onNavigate(edge.sourceId)}
        >
          {sourceTitle}
        </button>
        <span className="edge-card-arrow">→ {edge.label ?? typeName} →</span>
        <button
          type="button"
          className="link-button"
          onClick={() => onNavigate(edge.targetId)}
        >
          {targetTitle}
        </button>
      </p>
      {edge.description ? (
        <p className="edge-card-description">{edge.description}</p>
      ) : (
        <p className="muted edge-card-description">
          Aucune description. « Modifier » permet d’expliquer ce lien.
        </p>
      )}
      <div className="edge-card-actions">
        <button type="button" className="secondary" onClick={onEdit}>
          Modifier
        </button>
        <button
          type="button"
          className="secondary danger-text"
          onClick={onDelete}
        >
          Supprimer…
        </button>
      </div>
    </aside>
  );
}
