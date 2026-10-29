import { useId, useMemo, useRef, useState } from 'react';
import {
  NODE_TYPES,
  NODE_TYPE_LABELS,
  type NodeType,
} from '../../../shared/domain';
import type {
  GraphData,
  NodePosition,
  NodeSummary,
  TagInfo,
} from '../../../shared/model';
import { useClient, useRunner } from '../../app/context';
import {
  RelationDialog,
  type RelationFormValue,
} from '../relations/RelationDialog';
import {
  DEFAULT_FILTERS,
  LARGE_GRAPH_THRESHOLD,
  visibleGraph,
  type GraphFilters,
  type GraphScope,
} from './graph-model';
import { Graph3DView, type Graph3DViewHandle } from './Graph3DView';

export interface GraphPanelProps {
  graph: GraphData;
  nodes: readonly NodeSummary[];
  tags: readonly TagInfo[];
  selectedId: string | null;
  onSelect(id: string | null): void;
  /** Ouvre la fiche documentaire du nœud. */
  onOpen(id: string): void;
  /** Positions enregistrées : à reporter dans les données locales. */
  onPositionsSaved(positions: NodePosition[]): void;
  onRelationsChanged(): void;
}

const GRAPH_HELP =
  'Glisser d’un nœud à un autre : relier · Maj + glisser : déplacer · Double-clic : ouvrir · Glisser le fond : pivoter · Clic droit : déplacer la vue · Molette : zoom';

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Vue graphe 3D (§6.8) : portée, filtres, disposition, création de relations
 * en tirant un lien d'un nœud vers un autre.
 */
export function GraphPanel({
  graph,
  nodes,
  tags,
  selectedId,
  onSelect,
  onOpen,
  onPositionsSaved,
  onRelationsChanged,
}: GraphPanelProps) {
  const client = useClient();
  const run = useRunner();
  const view = useRef<Graph3DViewHandle>(null);
  const depthId = useId();
  const [scopeKind, setScopeKind] = useState<'all' | 'neighborhood'>(
    graph.nodes.length > LARGE_GRAPH_THRESHOLD ? 'neighborhood' : 'all',
  );
  const [depth, setDepth] = useState(2);
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [pendingLink, setPendingLink] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);

  const scope: GraphScope =
    scopeKind === 'neighborhood' && selectedId
      ? { kind: 'neighborhood', centerId: selectedId, depth }
      : { kind: 'all' };

  const visible = useMemo(
    () => visibleGraph(graph, scope, filters),
    // `scope` est recalculé à chaque rendu : dépendre de ses composantes.
    // oxlint-disable-next-line react/exhaustive-deps
    [graph, filters, scope.kind, selectedId, depth],
  );
  const savePositions = async (positions: NodePosition[]) => {
    if (positions.length === 0) return;
    onPositionsSaved(positions);
    await run(() => client.call('graph:savePositions', { positions }));
  };

  const createRelation = async (value: RelationFormValue) => {
    setPendingLink(null);
    if (await run(() => client.call('edge:create', value)))
      onRelationsChanged();
  };

  const activeFilterCount =
    filters.nodeTypes.size +
    filters.tagIds.size +
    filters.hiddenRelationTypeIds.size;
  const selectedTitle = selectedId
    ? (graph.nodes.find((node) => node.id === selectedId)?.title ?? null)
    : null;

  return (
    <section className="graph-panel" aria-label="Graphe">
      <div className="graph-toolbar">
        <div className="segmented" role="group" aria-label="Portée du graphe">
          <button
            type="button"
            aria-pressed={scopeKind === 'all'}
            onClick={() => setScopeKind('all')}
          >
            Tout l’espace
          </button>
          <button
            type="button"
            aria-pressed={scopeKind === 'neighborhood'}
            onClick={() => setScopeKind('neighborhood')}
          >
            Voisinage
          </button>
        </div>
        {scopeKind === 'neighborhood' && (
          <>
            <label htmlFor={depthId} className="inline-label">
              Niveaux
            </label>
            <select
              id={depthId}
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </>
        )}

        <details className="filters">
          <summary>
            Filtres{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </summary>
          <div className="filters-panel">
            <fieldset>
              <legend>Types de nœuds</legend>
              {NODE_TYPES.map((type) => (
                <label key={type} className="checkbox">
                  <input
                    type="checkbox"
                    checked={filters.nodeTypes.has(type)}
                    onChange={() =>
                      setFilters({
                        ...filters,
                        nodeTypes: toggled<NodeType>(filters.nodeTypes, type),
                      })
                    }
                  />
                  <span
                    className={`type-dot type-${type}`}
                    aria-hidden="true"
                  />
                  {NODE_TYPE_LABELS[type]}
                </label>
              ))}
              <p className="muted">Aucune case cochée : tous les types.</p>
            </fieldset>
            {tags.length > 0 && (
              <fieldset>
                <legend>Tags</legend>
                {tags.map((tag) => (
                  <label key={tag.id} className="checkbox">
                    <input
                      type="checkbox"
                      checked={filters.tagIds.has(tag.id)}
                      onChange={() =>
                        setFilters({
                          ...filters,
                          tagIds: toggled(filters.tagIds, tag.id),
                        })
                      }
                    />
                    {tag.name}
                  </label>
                ))}
              </fieldset>
            )}
            <fieldset>
              <legend>Relations affichées</legend>
              {graph.relationTypes.map((type) => (
                <label key={type.id} className="checkbox">
                  <input
                    type="checkbox"
                    checked={!filters.hiddenRelationTypeIds.has(type.id)}
                    onChange={() =>
                      setFilters({
                        ...filters,
                        hiddenRelationTypeIds: toggled(
                          filters.hiddenRelationTypeIds,
                          type.id,
                        ),
                      })
                    }
                  />
                  {type.name}
                </label>
              ))}
            </fieldset>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={filters.showHierarchy}
                onChange={(event) =>
                  setFilters({
                    ...filters,
                    showHierarchy: event.target.checked,
                  })
                }
              />
              Afficher la hiérarchie (pointillés)
            </label>
            {activeFilterCount > 0 && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setFilters({
                    ...DEFAULT_FILTERS,
                    showHierarchy: filters.showHierarchy,
                  })
                }
              >
                Réinitialiser les filtres
              </button>
            )}
          </div>
        </details>

        <span className="graph-help muted" title={GRAPH_HELP}>
          {GRAPH_HELP}
        </span>

        <button
          type="button"
          className="secondary"
          title="Disposition automatique des nœuds affichés"
          onClick={() => view.current?.relayout()}
        >
          Disposer
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="Zoom avant"
          onClick={() => view.current?.zoom(1.25)}
        >
          +
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="Zoom arrière"
          onClick={() => view.current?.zoom(0.8)}
        >
          −
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="Recentrer"
          title="Recentrer"
          onClick={() => view.current?.fit()}
        >
          ⤢
        </button>
      </div>

      {scopeKind === 'neighborhood' && !selectedId && (
        <p className="graph-hint">
          Sélectionnez un nœud pour afficher son voisinage.
        </p>
      )}

      <div className="graph-stage">
        {graph.nodes.length === 0 ? (
          <p className="muted empty-state">Aucun nœud à afficher.</p>
        ) : (
          <Graph3DView
            ref={view}
            visible={visible}
            relationTypes={graph.relationTypes}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpen={onOpen}
            onLink={(sourceId, targetId) =>
              setPendingLink({ sourceId, targetId })
            }
            onPositionsChanged={(positions) => void savePositions(positions)}
          />
        )}
        <ul className="graph-legend" aria-label="Légende">
          {NODE_TYPES.map((type) => (
            <li key={type}>
              <span className={`type-dot type-${type}`} aria-hidden="true" />
              {NODE_TYPE_LABELS[type]}
            </li>
          ))}
        </ul>
        <p className="graph-count muted">
          {visible.nodes.length} nœud(s) · {visible.edges.length} relation(s)
          {selectedTitle ? ` · « ${selectedTitle} »` : ''}
        </p>
      </div>

      {pendingLink && (
        <RelationDialog
          title="Nouvelle relation"
          nodes={nodes}
          relationTypes={graph.relationTypes}
          initial={pendingLink}
          submitLabel="Créer la relation"
          onSubmit={(value) => void createRelation(value)}
          onCancel={() => setPendingLink(null)}
        />
      )}
    </section>
  );
}
