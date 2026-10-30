import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  NODE_TYPES,
  NODE_TYPE_LABELS,
  type NodeType,
} from '../../../shared/domain';
import type {
  DocumentSummary,
  GraphData,
  NodePosition,
  NodeSummary,
  TagInfo,
} from '../../../shared/model';
import { useClient, useRunner } from '../../app/context';
import { usePreferences } from '../../app/preferences';
import {
  RelationDialog,
  type RelationFormValue,
} from '../relations/RelationDialog';
import {
  DEFAULT_FILTERS,
  LARGE_GRAPH_THRESHOLD,
  maskedNodeIds,
  visibleGraph,
  type GraphFilters,
  type GraphScope,
} from './graph-model';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { GraphScopeKind } from '../workspace/view-state';
import { useViewDispatch, useViewState } from '../workspace/view-state-context';
import { EdgeCard } from './EdgeCard';
import { Graph3DView, type Graph3DViewHandle } from './Graph3DView';

export interface GraphPanelProps {
  graph: GraphData;
  /** Centrer ce nœud (menu « Centrer dans le graphe »). */
  centerRequest?: { id: string; nonce: number } | null;
  nodes: readonly NodeSummary[];
  tags: readonly TagInfo[];
  onSelect(id: string | null): void;
  /** Ouvre la fiche documentaire du nœud. */
  onOpen(id: string): void;
  /** Positions enregistrées : à reporter dans les données locales. */
  onPositionsSaved(positions: NodePosition[]): void;
  onRelationsChanged(): void;
  /** Documents du nœud sélectionné (cartes affichées dans le graphe). */
  selectedDocuments: readonly DocumentSummary[] | null;
  /** Nœuds trouvés par la recherche ; `null` sans recherche active. */
  searchMatches: ReadonlySet<string> | null;
  onOpenDocument(documentId: string): void;
  onAddDocument(nodeId: string): void;
  /** Actions groupées sur la sélection multiple. */
  onBulkMove(): void;
  onBulkSetType(nodeType: NodeType): void;
  onBulkDelete(): void;
  /** Double-clic dans le vide : créer un nœud à cet endroit. */
  onCreateAt(position: { x: number; y: number; z: number }): void;
}

const GRAPH_HELP =
  'Clic : zoom et documents · Ctrl+clic / Ctrl+A : sélection multiple · Glisser d’un nœud à un autre : relier · Maj + glisser : déplacer · Double-clic dans le vide : nouveau nœud · Double-clic sur un nœud : ouvrir · Fond : pivoter (clic droit : déplacer) · Molette : zoom';

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
  centerRequest = null,
  nodes,
  tags,
  onSelect,
  onOpen,
  onPositionsSaved,
  onRelationsChanged,
  selectedDocuments,
  searchMatches,
  onOpenDocument,
  onAddDocument,
  onBulkMove,
  onBulkSetType,
  onBulkDelete,
  onCreateAt,
}: GraphPanelProps) {
  const { preferences } = usePreferences();
  const client = useClient();
  const run = useRunner();
  const view = useRef<Graph3DViewHandle>(null);
  const depthId = useId();
  const bulkTypeId = useId();
  // Portée, filtres et replis : état de la vue de l'espace (voir view-state).
  const {
    selectedId,
    multiSelection,
    graph: { scope, depth, filters, collapsed, hidden, solo },
  } = useViewState();
  const dispatch = useViewDispatch();
  const scopeKind =
    scope ??
    (graph.nodes.length > LARGE_GRAPH_THRESHOLD ? 'neighborhood' : 'all');
  const setScopeKind = (kind: GraphScopeKind) =>
    dispatch({ type: 'setScope', scope: kind });
  const setDepth = (value: number) =>
    dispatch({ type: 'setDepth', depth: value });
  const setFilters = (value: GraphFilters) =>
    dispatch({ type: 'setFilters', filters: value });
  const setCollapsed = (ids: ReadonlySet<string>) =>
    dispatch({ type: 'setCollapsed', ids });
  const onSetMultiSelection = (ids: ReadonlySet<string>) =>
    dispatch({ type: 'setMultiSelection', ids });
  const onToggleSelect = (id: string) => dispatch({ type: 'toggleMulti', id });
  /** Relation dont la fiche est affichée (clic sur un trait du graphe). */
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [edgeAction, setEdgeAction] = useState<'edit' | 'delete' | null>(null);
  const [pendingLink, setPendingLink] = useState<{
    sourceId: string;
    targetId: string;
  } | null>(null);

  const visible = useMemo(() => {
    const graphScope: GraphScope =
      scopeKind === 'neighborhood' && selectedId
        ? { kind: 'neighborhood', centerId: selectedId, depth }
        : { kind: 'all' };
    return visibleGraph(graph, graphScope, filters, {
      collapsed,
      hidden,
      solo,
    });
  }, [graph, filters, collapsed, hidden, solo, scopeKind, selectedId, depth]);
  // Œil : nœuds absents du graphe (pour signaler une sélection masquée).
  const masked = useMemo(
    () => maskedNodeIds(graph.nodes, { hidden, solo }),
    [graph, hidden, solo],
  );
  const selectedMasked = !!selectedId && masked.has(selectedId);
  const soloTitle = solo
    ? (graph.nodes.find((node) => node.id === solo)?.title ?? null)
    : null;
  /**
   * Réaffiche le nœud sélectionné : lui et ses ancêtres ne sont plus masqués,
   * et le solo est quitté s'il le laissait de côté.
   */
  const revealSelected = () => {
    if (!selectedId) return;
    const parentOf = new Map(
      graph.nodes.map((node) => [node.id, node.parentId]),
    );
    const chain: string[] = [];
    for (
      let id: string | null = selectedId;
      id && !chain.includes(id);
      id = parentOf.get(id) ?? null
    ) {
      chain.push(id);
    }
    dispatch({ type: 'unhide', ids: chain });
    const remaining = new Set([...hidden].filter((id) => !chain.includes(id)));
    if (
      maskedNodeIds(graph.nodes, { hidden: remaining, solo }).has(selectedId)
    ) {
      dispatch({ type: 'setSolo', id: null });
    }
  };
  const parents = useMemo(
    () =>
      new Set(
        graph.nodes.flatMap((node) => (node.parentId ? [node.parentId] : [])),
      ),
    [graph],
  );
  const hiddenByCollapse = [
    ...(visible.hiddenDescendants?.values() ?? []),
  ].reduce((total, count) => total + count, 0);
  const canCollapseSelected = !!selectedId && parents.has(selectedId);
  const selectedCollapsed = !!selectedId && collapsed.has(selectedId);
  /** Ne garde que les racines dépliées : une vue d'ensemble par branche. */
  const collapseAll = () =>
    setCollapsed(
      new Set(
        graph.nodes
          .filter((node) => !node.parentId && parents.has(node.id))
          .map((node) => node.id),
      ),
    );
  const visibleIds = useMemo(
    () => new Set(visible.nodes.map((node) => node.id)),
    [visible],
  );
  const selectionShortcuts = useRef({
    visibleIds,
    multiSelection,
    onSetMultiSelection,
  });
  useEffect(() => {
    selectionShortcuts.current = {
      visibleIds,
      multiSelection,
      onSetMultiSelection,
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;
      const {
        visibleIds: ids,
        multiSelection: current,
        onSetMultiSelection: set,
      } = selectionShortcuts.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        set(ids);
      } else if (event.key === 'Escape' && current.size > 0) {
        set(new Set());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Masquée si la relation n'est plus affichée (filtre, repliage, suppression).
  const selectedEdge = selectedEdgeId
    ? (visible.edges.find((edge) => edge.id === selectedEdgeId) ?? null)
    : null;
  const titleOf = (id: string) =>
    graph.nodes.find((node) => node.id === id)?.title ?? '?';
  /** Sélectionner un nœud ferme la fiche de la relation. */
  const selectNode = (id: string | null) => {
    setSelectedEdgeId(null);
    onSelect(id);
  };

  useEffect(() => {
    if (!selectedEdgeId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [role="dialog"]')) return;
      if (event.key === 'Escape') setSelectedEdgeId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedEdgeId]);

  const updateEdge = async (value: RelationFormValue) => {
    if (!selectedEdge) return;
    setEdgeAction(null);
    const done = await run(() =>
      client.call('edge:update', {
        id: selectedEdge.id,
        relationTypeId: value.relationTypeId,
        label: value.label,
        description: value.description,
      }),
    );
    if (done) onRelationsChanged();
  };

  const deleteEdge = async () => {
    if (!selectedEdge) return;
    setEdgeAction(null);
    const done = await run(() =>
      client.call('edge:delete', { id: selectedEdge.id }),
    );
    if (done !== undefined) {
      setSelectedEdgeId(null);
      onRelationsChanged();
    }
  };

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

        {/* L'élément reste quand l'aide est masquée : il pousse les boutons à droite. */}
        <span className="graph-help muted" title={GRAPH_HELP}>
          {preferences.showGraphHints ? GRAPH_HELP : ''}
        </span>

        <div className="segmented" role="group" aria-label="Repliage">
          <button
            type="button"
            disabled={!canCollapseSelected}
            title={
              canCollapseSelected
                ? selectedCollapsed
                  ? 'Afficher les descendants du nœud sélectionné'
                  : 'Masquer les descendants du nœud sélectionné'
                : 'Sélectionnez un nœud qui a des enfants'
            }
            onClick={() =>
              selectedId && setCollapsed(toggled(collapsed, selectedId))
            }
          >
            {selectedCollapsed ? 'Déplier' : 'Replier'}
          </button>
          <button
            type="button"
            title="Replier chaque racine : une vue d’ensemble par branche"
            disabled={parents.size === 0}
            onClick={collapseAll}
          >
            Tout replier
          </button>
          <button
            type="button"
            disabled={collapsed.size === 0}
            onClick={() => setCollapsed(new Set())}
          >
            Tout déplier
          </button>
        </div>
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

      {(visible.maskedCount ?? 0) > 0 && (
        <div className="graph-mask-bar" role="status">
          <span>
            {soloTitle ? `Branche seule : « ${soloTitle} » · ` : ''}
            {visible.maskedCount} nœud
            {visible.maskedCount === 1 ? ' masqué' : 's masqués'}
          </span>
          <button
            type="button"
            className="link-button"
            onClick={() => dispatch({ type: 'showAll' })}
          >
            Tout réafficher
          </button>
        </div>
      )}

      {selectedMasked && (
        <p className="graph-hint graph-hint-masked">
          « {graph.nodes.find((node) => node.id === selectedId)?.title} » est
          masqué dans le graphe.{' '}
          <button
            type="button"
            className="link-button"
            onClick={revealSelected}
          >
            Le réafficher
          </button>
        </p>
      )}

      {scopeKind === 'neighborhood' && !selectedId && (
        <p className="graph-hint">
          Sélectionnez un nœud pour afficher son voisinage.
        </p>
      )}

      {multiSelection.size > 0 && (
        <div
          className="bulk-bar"
          role="toolbar"
          aria-label="Actions sur la sélection"
        >
          <strong>
            {multiSelection.size} nœud{multiSelection.size > 1 ? 's' : ''}{' '}
            sélectionné{multiSelection.size > 1 ? 's' : ''}
          </strong>
          <button type="button" className="secondary" onClick={onBulkMove}>
            Déplacer sous…
          </button>
          <label className="visually-hidden" htmlFor={bulkTypeId}>
            Changer le type
          </label>
          <select
            id={bulkTypeId}
            value=""
            onChange={(event) => {
              if (event.target.value)
                onBulkSetType(event.target.value as NodeType);
            }}
          >
            <option value="">Changer le type…</option>
            {NODE_TYPES.map((type) => (
              <option key={type} value={type}>
                {NODE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="secondary danger-text"
            onClick={onBulkDelete}
          >
            Supprimer…
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => onSetMultiSelection(new Set())}
          >
            Désélectionner
          </button>
        </div>
      )}

      <div className="graph-stage">
        {graph.nodes.length === 0 ? (
          <p className="muted empty-state">Aucun nœud à afficher.</p>
        ) : (
          <Graph3DView
            ref={view}
            centerRequest={centerRequest}
            visible={visible}
            relationTypes={graph.relationTypes}
            selectedId={selectedId}
            selectedDocuments={selectedDocuments}
            searchMatches={searchMatches}
            onOpenDocument={onOpenDocument}
            onAddDocument={onAddDocument}
            multiSelection={multiSelection}
            onToggleSelect={onToggleSelect}
            onCreateAt={onCreateAt}
            onSelect={selectNode}
            selectedEdgeId={selectedEdge?.id ?? null}
            onSelectEdge={setSelectedEdgeId}
            onOpen={onOpen}
            onLink={(sourceId, targetId) =>
              setPendingLink({ sourceId, targetId })
            }
            onPositionsChanged={(positions) => void savePositions(positions)}
          />
        )}
        {selectedEdge && (
          <EdgeCard
            edge={selectedEdge}
            relationType={graph.relationTypes.find(
              (type) => type.id === selectedEdge.relationTypeId,
            )}
            sourceTitle={titleOf(selectedEdge.sourceId)}
            targetTitle={titleOf(selectedEdge.targetId)}
            onNavigate={selectNode}
            onEdit={() => setEdgeAction('edit')}
            onDelete={() => setEdgeAction('delete')}
            onClose={() => setSelectedEdgeId(null)}
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
          {hiddenByCollapse > 0 ? ` · ${hiddenByCollapse} replié(s)` : ''}
          {selectedTitle ? ` · « ${selectedTitle} »` : ''}
        </p>
      </div>

      {selectedEdge && edgeAction === 'edit' && (
        <RelationDialog
          title="Modifier la relation"
          nodes={nodes}
          relationTypes={graph.relationTypes}
          initial={{
            sourceId: selectedEdge.sourceId,
            targetId: selectedEdge.targetId,
            relationTypeId: selectedEdge.relationTypeId,
            label: selectedEdge.label,
            description: selectedEdge.description,
          }}
          lockEnds
          submitLabel="Enregistrer"
          onSubmit={(value) => void updateEdge(value)}
          onCancel={() => setEdgeAction(null)}
        />
      )}
      {selectedEdge && edgeAction === 'delete' && (
        <ConfirmDialog
          title="Supprimer la relation ?"
          confirmLabel="Supprimer la relation"
          danger
          onConfirm={() => void deleteEdge()}
          onCancel={() => setEdgeAction(null)}
        >
          <p>
            La relation « {titleOf(selectedEdge.sourceId)} →{' '}
            {titleOf(selectedEdge.targetId)} » sera supprimée. Les deux nœuds
            sont conservés.
          </p>
        </ConfirmDialog>
      )}
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
