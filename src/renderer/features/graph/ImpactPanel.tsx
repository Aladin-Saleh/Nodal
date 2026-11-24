import { useId } from 'react';
import { impactDirection, type ImpactHit } from '../../../shared/graph-impact';
import type { RelationTypeInfo } from '../../../shared/model';

export interface ImpactPanelProps {
  title: string;
  hits: readonly ImpactHit[];
  titleOf(id: string): string;
  relationTypes: readonly RelationTypeInfo[];
  onSelect(id: string): void;
  onClose(): void;
}

/** Panneau droit : nœuds à revoir si un nœud change (« Impact… »). */
export function ImpactPanel({
  title,
  hits,
  titleOf,
  relationTypes,
  onSelect,
  onClose,
}: ImpactPanelProps) {
  const headingId = useId();
  const typeById = new Map(relationTypes.map((type) => [type.id, type]));
  const describe = (hit: ImpactHit) => {
    const name = typeById.get(hit.relationTypeId)?.name ?? 'relation';
    return impactDirection(name) === 'target'
      ? `← ${titleOf(hit.fromId)} ${name}`
      : `${name} ${titleOf(hit.fromId)}`;
  };
  return (
    <section className="path-panel" aria-labelledby={headingId}>
      <div className="path-panel-header">
        <h2 id={headingId}>Impact</h2>
        <button
          type="button"
          className="secondary"
          aria-label="Fermer l’impact"
          title="Fermer l’impact"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="muted">
        À revoir si « {title} » (ou l’un de ses sous-nœuds) change, par les
        relations de dépendance.
      </p>
      {hits.length === 0 ? (
        <p role="status" className="path-none">
          Aucun nœud ne dépend de « {title} ». Les relations « est lié à » et
          les types propres à l’espace ne comptent pas.
        </p>
      ) : (
        <>
          <p role="status">
            {hits.length === 1 ? '1 nœud' : `${hits.length} nœuds`}
          </p>
          <ul className="path-steps">
            {hits.map((hit) => (
              <li key={hit.nodeId}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onSelect(hit.nodeId)}
                >
                  {titleOf(hit.nodeId)}
                </button>{' '}
                <span className="path-link muted">
                  {describe(hit)}
                  {hit.depth > 1 && ` (à ${hit.depth} liens)`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
