import { useId } from 'react';
import type { PathStep } from '../../../shared/graph-path';
import type { EdgeInfo, RelationTypeInfo } from '../../../shared/model';

export interface PathPanelProps {
  fromTitle: string;
  toTitle: string;
  /** `null` : aucun chemin trouvé. */
  steps: readonly PathStep[] | null;
  maxDepth: number;
  includeHierarchy: boolean;
  onIncludeHierarchyChange(include: boolean): void;
  titleOf(id: string): string;
  edges: readonly EdgeInfo[];
  relationTypes: readonly RelationTypeInfo[];
  /** Nœuds du chemin masqués dans le graphe (œil, branche seule). */
  hiddenCount: number;
  onSelect(id: string): void;
  onClose(): void;
}

/** Lien qui mène à une étape, lisible : « → utilise (lit) », « ↑ parent ». */
export function describeStep(
  step: PathStep,
  edges: ReadonlyMap<string, EdgeInfo>,
  relationTypes: ReadonlyMap<string, RelationTypeInfo>,
): string {
  const via = step.via;
  if (!via) return '';
  if (via.kind !== 'relation') {
    return via.kind === 'parent' ? '↑ parent' : '↓ enfant';
  }
  const name = relationTypes.get(via.relationTypeId)?.name ?? 'relation';
  const label = edges.get(via.edgeId)?.label;
  return `${via.forward ? '→' : '←'} ${name}${label ? ` (${label})` : ''}`;
}

/** Panneau droit : étapes du chemin entre deux nœuds (« Chemin vers… »). */
export function PathPanel({
  fromTitle,
  toTitle,
  steps,
  maxDepth,
  includeHierarchy,
  onIncludeHierarchyChange,
  titleOf,
  edges,
  relationTypes,
  hiddenCount,
  onSelect,
  onClose,
}: PathPanelProps) {
  const headingId = useId();
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  const typeById = new Map(relationTypes.map((type) => [type.id, type]));
  return (
    <section className="path-panel" aria-labelledby={headingId}>
      <div className="path-panel-header">
        <h2 id={headingId}>Chemin</h2>
        <button
          type="button"
          className="secondary"
          aria-label="Fermer le chemin"
          title="Fermer le chemin"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="muted">
        De « {fromTitle} » à « {toTitle} »
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={includeHierarchy}
          onChange={(event) => onIncludeHierarchyChange(event.target.checked)}
        />
        Passer aussi par la hiérarchie (parent / enfant)
      </label>
      {steps ? (
        <>
          <p role="status">
            {steps.length - 1 === 1 ? '1 lien' : `${steps.length - 1} liens`}
          </p>
          <ol className="path-steps">
            {steps.map((step) => (
              <li key={step.nodeId}>
                {step.via && (
                  <span className="path-link muted">
                    {describeStep(step, edgeById, typeById)}
                  </span>
                )}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onSelect(step.nodeId)}
                >
                  {titleOf(step.nodeId)}
                </button>
              </li>
            ))}
          </ol>
          {hiddenCount > 0 && (
            <p className="muted">
              {hiddenCount === 1
                ? '1 nœud du chemin est masqué dans le graphe (œil).'
                : `${hiddenCount} nœuds du chemin sont masqués dans le graphe (œil).`}
            </p>
          )}
        </>
      ) : (
        <p role="status" className="path-none">
          Aucun chemin entre « {fromTitle} » et « {toTitle} » en {maxDepth}{' '}
          liens au plus
          {includeHierarchy
            ? '.'
            : ' par les relations. Essayez en passant aussi par la hiérarchie.'}
        </p>
      )}
    </section>
  );
}
