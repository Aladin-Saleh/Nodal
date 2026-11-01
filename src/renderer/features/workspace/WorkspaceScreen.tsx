import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodalError } from '../../../shared/errors';
import type { ContentType, NodeType } from '../../../shared/domain';
import type { WorkspaceInfo } from '../../../shared/ipc-contract';
import type {
  ChildrenStrategy,
  LlmExportOptions,
  NodeSummary,
  SearchHit,
} from '../../../shared/model';
import {
  useClient,
  useReportError,
  useReportInfo,
  useRunner,
  useSaveTracker,
} from '../../app/context';
import { usePreferences } from '../../app/preferences';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { actionForKey, type PaletteNode } from '../commands/actions';
import { CommandPalette } from '../commands/CommandPalette';
import { maskedNodeIds } from '../graph/graph-model';
import { PathPanel } from '../graph/PathPanel';
import {
  PATH_MAX_DEPTH,
  pathLinkIds,
  shortestPath,
} from '../../../shared/graph-path';
import type { Language } from '../documents/DocumentsPanel';
import { NodeLinksContext } from '../editor/node-links';
import { createLinkResolver } from '../../../shared/wiki-links';
import { NodeProperties } from '../nodes/NodeProperties';
import { ancestorIds, buildTreeIndex, siblingsOf } from '../nodes/tree';
import { CenterPane } from './CenterPane';
import { HealthDialog } from './HealthDialog';
import { TopBar, type ViewMode } from './TopBar';
import { TreePane } from './TreePane';
import { useGraphViewPersistence } from './useGraphViewPersistence';
import { canStep } from './nav-history';
import { useStaleNodes } from './useStaleNodes';
import { useWorkspaceData } from './useWorkspaceData';
import {
  nodeActions,
  workspaceActions,
  type WorkspaceActionState,
  type WorkspaceCommands,
} from './workspace-actions';
import {
  ViewStateProvider,
  useViewDispatch,
  useViewState,
} from './view-state-context';
import {
  NO_OVERLAYS,
  WorkspaceDialogs,
  type DialogState,
  type Overlays,
} from './WorkspaceDialogs';

export interface WorkspaceScreenProps {
  workspace: WorkspaceInfo;
  onWorkspaceChanged(workspace: WorkspaceInfo): void;
  onClose(): void;
  onDeleted(): void;
  onOpenPreferences(): void;
}

/**
 * Espace ouvert (§7) : arborescence à gauche, documents ou graphe au centre,
 * propriétés et relations à droite. L'état de la vue (sélection, dépliage,
 * réglages du graphe) est partagé par un contexte (voir view-state).
 */
export function WorkspaceScreen(props: WorkspaceScreenProps) {
  const { preferences } = usePreferences();
  return (
    <ViewStateProvider linkFolding={preferences.linkTreeAndGraphFolding}>
      <WorkspaceView {...props} />
    </ViewStateProvider>
  );
}

function WorkspaceView({
  workspace,
  onWorkspaceChanged,
  onClose,
  onDeleted,
  onOpenPreferences,
}: WorkspaceScreenProps) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const reportInfo = useReportInfo();
  const tracker = useSaveTracker();
  const {
    selectedId,
    multiSelection,
    graph: { hidden, solo },
    history,
  } = useViewState();
  const dispatch = useViewDispatch();
  const data = useWorkspaceData(selectedId);
  const { nodes, detail } = data;
  const graphViews = useGraphViewPersistence(data.graph);

  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [overlays, setOverlays] = useState<Overlays>(NO_OVERLAYS);
  const openOverlay = <K extends keyof Overlays>(name: K, value: Overlays[K]) =>
    setOverlays((current) => ({ ...current, [name]: value }));
  const closeOverlay = (name: keyof Overlays) =>
    setOverlays((current) => ({ ...current, [name]: NO_OVERLAYS[name] }));

  // La vue Graphe est la vue par défaut à l'ouverture d'un espace.
  const { preferences } = usePreferences();
  // Lue une seule fois : changer la préférence ne bascule pas la vue en cours.
  const [view, setView] = useState<ViewMode>(
    preferences.startView === 'documents' ? 'documents' : 'graph',
  );
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [exporting, setExporting] = useState(false);
  /** « Chemin vers… » : extrémités du chemin affiché. */
  const [pathQuery, setPathQuery] = useState<{
    fromId: string;
    toId: string;
    includeHierarchy: boolean;
  } | null>(null);
  /** Choix du nœud d'arrivée en cours, depuis ce nœud. */
  const [pathPickFrom, setPathPickFrom] = useState<string | null>(null);
  /** Palette de commandes ouverte ; `actionsOnly` : Ctrl+Maj+P. */
  const [palette, setPalette] = useState<{ actionsOnly: boolean } | null>(null);

  /** Incrémenté à chaque document enregistré (suggestions de liens). */
  const [documentsRevision, setDocumentsRevision] = useState(0);
  /** Documentation possiblement obsolète : revérifiée après chaque écriture. */
  const staleNodes = useStaleNodes(
    documentsRevision + data.externalRevision * 100_000,
  );
  const staleIds = useMemo(
    () => new Set(staleNodes.stale.keys()),
    [staleNodes.stale],
  );
  /** Demande de focus sur la recherche (Ctrl+F). */
  const [searchFocus, setSearchFocus] = useState(0);
  /** Nœud à renommer : son titre reçoit le focus dès que sa fiche est affichée. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** Demande de centrage dans le graphe (même nœud : nouvelle demande). */
  const [centerRequest, setCenterRequest] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const searchMatches = useMemo(
    () => (searchHits ? new Set(searchHits.map((hit) => hit.nodeId)) : null),
    [searchHits],
  );

  const index = useMemo(() => buildTreeIndex(nodes), [nodes]);
  const selected = selectedId ? (index.byId.get(selectedId) ?? null) : null;

  /** Sélectionne un nœud et déplie ses ancêtres dans l'arborescence. */
  const select = useCallback(
    (id: string | null) =>
      dispatch({
        type: 'select',
        id,
        reveal: id ? ancestorIds(index, id) : [],
      }),
    [dispatch, index],
  );
  const expand = (ids: readonly string[]) => dispatch({ type: 'expand', ids });

  const nodeChanged = () => {
    void data.refreshNodes();
    data.refreshDetail();
  };

  const relationsChanged = () => {
    data.bumpRelations();
    nodeChanged();
  };

  // --- Actions sur les nœuds -------------------------------------------------

  const createNode = async (
    title: string,
    nodeType: NodeType,
    chosenParentId: string | null,
  ) => {
    if (dialog?.kind !== 'new') return;
    const { position } = dialog;
    const parentId = position ? chosenParentId : dialog.parentId;
    const { gapKey } = dialog;
    setDialog(null);
    const created = await run(() =>
      client.call('node:create', { parentId, title, nodeType }),
    );
    if (!created) return;
    if (gapKey) {
      // Sujet à documenter traité : il quitte la liste.
      await run(() =>
        client.call('gap:setStatus', { key: gapKey, status: 'done' }),
      );
    }
    if (position) {
      // Le nœud apparaît là où l'on a double-cliqué.
      await run(() =>
        client.call('graph:savePositions', {
          positions: [{ id: created.id, ...position }],
        }),
      );
    }
    await data.refreshNodes();
    if (parentId) expand([parentId]);
    select(created.id);
  };

  const moveTo = async (
    node: NodeSummary,
    parentId: string | null,
    position?: number,
  ) => {
    setDialog(null);
    const done = await run(() =>
      client.call('node:move', {
        id: node.id,
        parentId,
        ...(position === undefined ? {} : { index: position }),
      }),
    );
    if (done === undefined) return;
    if (parentId) expand([parentId]);
    nodeChanged();
  };

  const bulkMove = async (parentId: string | null) => {
    const ids = [...multiSelection];
    setDialog(null);
    const done = await run(() =>
      client.call('node:moveMany', { ids, parentId }),
    );
    if (done === undefined) return;
    if (parentId) expand([parentId]);
    nodeChanged();
  };

  const bulkSetType = async (nodeType: NodeType) => {
    const ids = [...multiSelection];
    const done = await run(() =>
      client.call('node:setTypeMany', { ids, nodeType }),
    );
    if (done !== undefined) nodeChanged();
  };

  const askBulkDelete = async () => {
    const ids = [...multiSelection];
    try {
      const impact = await client.call('node:getDeletionImpactMany', { ids });
      setDialog({ kind: 'bulkDelete', ids, impact });
    } catch (error) {
      reportError(error);
    }
  };

  const bulkDelete = async (
    ids: string[],
    childrenStrategy: ChildrenStrategy,
  ) => {
    setDialog(null);
    await tracker.flushAll();
    const done = await run(() =>
      client.call('node:deleteMany', { ids, childrenStrategy }),
    );
    if (done === undefined) return;
    dispatch({ type: 'setMultiSelection', ids: new Set() });
    if (selectedId && ids.includes(selectedId)) select(null);
    void data.refreshNodes();
    void data.refreshTags();
    data.refreshDetail();
  };

  const shift = (offset: -1 | 1) => {
    if (!selected) return;
    const siblings = siblingsOf(index, selected);
    const position = siblings.findIndex(
      (sibling) => sibling.id === selected.id,
    );
    const target = position + offset;
    if (target < 0 || target >= siblings.length) return;
    void moveTo(selected, selected.parentId, target);
  };

  const duplicate = async (node: NodeSummary, includeChildren: boolean) => {
    setDialog(null);
    const copy = await run(() =>
      client.call('node:duplicate', { id: node.id, includeChildren }),
    );
    if (!copy) return;
    await data.refreshNodes();
    select(copy.id);
  };

  const askDelete = async (id: string) => {
    const node = index.byId.get(id);
    if (!node) return;
    try {
      const impact = await client.call('node:getDeletionImpact', { id });
      setDialog({ kind: 'delete', node, impact });
    } catch (error) {
      reportError(error);
    }
  };

  const deleteNode = async (
    node: NodeSummary,
    childrenStrategy: ChildrenStrategy,
  ) => {
    setDialog(null);
    // Écrire d'abord les modifications en attente (résumé, document…).
    await tracker.flushAll();
    const done = await run(() =>
      client.call('node:delete', { id: node.id, childrenStrategy }),
    );
    if (done === undefined) return;
    select(node.parentId);
    void data.refreshNodes();
    void data.refreshTags();
  };

  /** Valide des nœuds ajoutés par l'IA : ils ne sont plus signalés comme tels. */
  const validate = async (ids: string[]) => {
    const result = await run(() =>
      client.call('assistant:validateNodes', { ids }),
    );
    if (!result) return;
    reportInfo(
      result.validated === 1
        ? '1 nœud validé.'
        : `${result.validated} nœuds validés.`,
    );
    nodeChanged();
  };

  const renameNode = async (title: string) => {
    if (!detail) return false;
    const updated = await run(() =>
      client.call('node:update', { id: detail.id, title }),
    );
    if (updated) nodeChanged();
    return Boolean(updated);
  };

  /** Renommer (F2, menu contextuel) : titre de la fiche, en vue Documents. */
  const rename = (id: string) => {
    setRenamingId(id);
    select(id);
    setView('documents');
  };

  // --- Documents depuis le graphe ou la recherche --------------------------

  const openDocument = (documentId: string, nodeId?: string) => {
    if (nodeId && nodeId !== selectedId) select(nodeId);
    openOverlay('editingDocumentId', documentId);
  };

  const createDocument = async (
    nodeId: string,
    title: string,
    contentType: ContentType,
    language: Language | null,
  ) => {
    closeOverlay('addingDocumentFor');
    const created = await run(() =>
      client.call('document:create', { nodeId, title, contentType, language }),
    );
    if (!created) return;
    data.refreshDetail();
    openOverlay('editingDocumentId', created.id);
  };

  const exportWorkspace = async () => {
    setExporting(true);
    try {
      // Exporter le contenu à jour : écrire d'abord ce qui est en attente.
      await tracker.flushAll();
      const result = await run(() => client.call('workspace:export'));
      if (result) {
        reportInfo(
          `Espace exporté dans ${result.folderPath} (${result.nodeCount} nœuds, ${result.documentCount} documents, ${result.attachmentCount} pièces jointes).`,
        );
      }
    } finally {
      setExporting(false);
    }
  };

  const exportForLlm = async (options: LlmExportOptions) => {
    closeOverlay('llmExport');
    setExporting(true);
    try {
      await tracker.flushAll();
      const result = await run(() =>
        client.call('workspace:exportLlm', options),
      );
      if (result) {
        reportInfo(
          `Export LLM créé dans ${result.folderPath} : ${result.nodeCount} nœuds, ${result.documentCount} documents, ${result.chunkCount} fragments (tokens comptés avec ${result.tokenizer}).`,
        );
      }
    } finally {
      setExporting(false);
    }
  };

  /** Lien interne [[Titre]] : ouvre le nœud correspondant (§6.3). */
  /** Lien interne [[...]] d'un document : ouvre le nœud visé (§6.3). */
  const openLinkedNode = (id: string) => {
    if (!index.byId.has(id)) {
      reportError(new NodalError('NOT_FOUND', 'Ce nœud n’existe plus.'));
      return;
    }
    closeOverlay('editingDocumentId');
    select(id);
  };

  const showSearchResults = (hits: SearchHit[] | null) => {
    setSearchHits(hits);
    if (!hits || hits.length === 0) return;
    // Déplier l'arborescence jusqu'aux nœuds trouvés.
    expand(hits.flatMap((hit) => ancestorIds(index, hit.nodeId)));
  };

  /** Sélectionne le nœud et le centre dans la vue graphe. */
  const center = (id: string) => {
    select(id);
    setView('graph');
    setCenterRequest((current) => ({
      id,
      nonce: (current?.nonce ?? 0) + 1,
    }));
  };

  // --- Actions : palette, menus, raccourcis clavier (§7.1) -----------------

  const commands: WorkspaceCommands = {
    newNode: (parentId) => setDialog({ kind: 'new', parentId }),
    rename,
    addDocument: (id) => openOverlay('addingDocumentFor', id),
    toggleHidden: (id) => dispatch({ type: 'toggleHidden', id }),
    toggleSolo: (id) => dispatch({ type: 'toggleSolo', id }),
    showAll: () => dispatch({ type: 'showAll' }),
    center,
    pathFrom: setPathPickFrom,
    move: (node) => setDialog({ kind: 'move', nodes: [node], bulk: false }),
    duplicate: (node) => setDialog({ kind: 'duplicate', node }),
    validate: (id) => void validate([id]),
    delete: (id) => void askDelete(id),
    setView,
    applyView: (id) => {
      graphViews.apply(id);
      setView('graph');
    },
    navigate: (direction) =>
      dispatch({
        type: 'navigate',
        direction,
        exists: (id) => index.byId.has(id),
        reveal: (id) => ancestorIds(index, id),
      }),
    focusSearch: () => setSearchFocus((count) => count + 1),
    openPalette: (actionsOnly) => setPalette({ actionsOnly }),
    save: () => void tracker.flushAll(),
    tags: () => setDialog({ kind: 'tags' }),
    relationTypes: () => setDialog({ kind: 'relationTypes' }),
    exportPortable: () => void exportWorkspace(),
    exportLlm: () => openOverlay('llmExport', true),
    connectAssistant: () => openOverlay('mcp', true),
    activity: () => openOverlay('activity', true),
    health: (focus) => openOverlay('health', focus),
    quickCapture: () => void client.call('capture:open').catch(reportError),
    openInbox: () =>
      void client.call('capture:getInbox').then((id) => {
        if (id) select(id);
        else
          reportInfo(
            'La boîte de réception est vide : utilisez la capture rapide.',
          );
      }, reportError),
    settings: () => setDialog({ kind: 'settings' }),
    preferences: onOpenPreferences,
    help: () => openOverlay('help', true),
    close: onClose,
  };
  const actionState: WorkspaceActionState = {
    view,
    exporting,
    hidden,
    solo,
    masking: hidden.size > 0 || solo !== null,
    canGoBack: canStep(history, -1, (id) => index.byId.has(id)),
    canGoForward: canStep(history, 1, (id) => index.byId.has(id)),
    savedViews: graphViews.views,
  };
  const actions = [
    ...nodeActions(selected, actionState, commands),
    ...workspaceActions(actionState, commands),
  ];
  const actionsForNode = (id: string) =>
    nodeActions(index.byId.get(id) ?? null, actionState, commands);

  const paletteNodes = useMemo<PaletteNode[]>(
    () =>
      nodes.map((node) => ({
        id: node.id,
        title: node.title,
        path: ancestorIds(index, node.id)
          .toReversed()
          .map((id) => index.byId.get(id)?.title ?? '')
          .join(' › '),
      })),
    [nodes, index],
  );

  // --- Chemin entre deux nœuds ----------------------------------------------

  const graph = data.graph;
  // Un nœud supprimé depuis ferme le chemin.
  const activePath =
    pathQuery &&
    index.byId.has(pathQuery.fromId) &&
    index.byId.has(pathQuery.toId)
      ? pathQuery
      : null;
  const pathSteps = useMemo(
    () =>
      activePath && graph
        ? shortestPath(
            graph.nodes,
            graph.edges,
            activePath.fromId,
            activePath.toId,
            {
              includeHierarchy: activePath.includeHierarchy,
              maxDepth: PATH_MAX_DEPTH,
            },
          )
        : null,
    [activePath, graph],
  );
  const pathHighlight = useMemo(
    () =>
      pathSteps
        ? {
            nodeIds: new Set(pathSteps.map((step) => step.nodeId)),
            linkIds: new Set(pathLinkIds(pathSteps)),
          }
        : null,
    [pathSteps],
  );
  const pathHiddenCount = useMemo(() => {
    if (!pathSteps) return 0;
    const masked = maskedNodeIds(nodes, { hidden, solo });
    return pathSteps.filter((step) => masked.has(step.nodeId)).length;
  }, [pathSteps, nodes, hidden, solo]);

  const linkResolver = useMemo(() => createLinkResolver(nodes), [nodes]);

  const modalOpen =
    dialog !== null ||
    palette !== null ||
    pathPickFrom !== null ||
    overlays.health !== null ||
    overlays.editingDocumentId !== null ||
    overlays.addingDocumentFor !== null;
  // Lu par l'écouteur clavier, installé une seule fois.
  const shortcuts = useRef({ actions, modalOpen });
  useEffect(() => {
    shortcuts.current = { actions, modalOpen };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { actions: current, modalOpen: blocked } = shortcuts.current;
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      const action = actionForKey(current, event, typing);
      // Une fenêtre ouverte garde le clavier, sauf pour l'aide (F1).
      if (!action || (blocked && action.id !== 'app.help')) return;
      event.preventDefault();
      action.run();
    };
    // Boutons 4 / 5 de la souris : précédent / suivant.
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      const { actions: current, modalOpen: blocked } = shortcuts.current;
      if (blocked) return;
      event.preventDefault();
      const id = event.button === 3 ? 'nav.back' : 'nav.forward';
      const action = current.find((candidate) => candidate.id === id);
      if (action?.enabled) action.run();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  /** Derniers nœuds ouverts (palette sans requête), du plus récent. */
  const recentNodes = useMemo(() => {
    const byId = new Map(paletteNodes.map((node) => [node.id, node]));
    const seen = new Set(selectedId ? [selectedId] : []);
    const result: PaletteNode[] = [];
    for (const id of history.entries.toReversed()) {
      const node = byId.get(id);
      if (!node || seen.has(id)) continue;
      seen.add(id);
      result.push(node);
      if (result.length === 8) break;
    }
    return result;
  }, [history, paletteNodes, selectedId]);

  return (
    <NodeLinksContext.Provider
      value={{
        nodes: paletteNodes,
        resolver: linkResolver,
        open: openLinkedNode,
        onLinksChanged: relationsChanged,
        onDocumentSaved: () => setDocumentsRevision((count) => count + 1),
      }}
    >
      <div className="workspace-screen">
        <TopBar
          workspace={workspace}
          searchFocus={searchFocus}
          onSearchResults={showSearchResults}
          onSelectNode={(id) => select(id)}
          onOpenDocument={openDocument}
          view={view}
          onViewChange={setView}
          exporting={exporting}
          actions={actions}
        />

        <div className={detail || activePath ? 'panes' : 'panes no-properties'}>
          <TreePane
            index={index}
            searchMatches={searchMatches}
            onSelect={select}
            onNew={(parentId) => setDialog({ kind: 'new', parentId })}
            onShift={shift}
            onDelete={(id) => void askDelete(id)}
            onRename={rename}
            onMove={(id, move) => {
              const node = index.byId.get(id);
              if (node) void moveTo(node, move.parentId, move.index);
            }}
            actionsForNode={actionsForNode}
            stale={staleIds}
          />

          <CenterPane
            view={view}
            centerRequest={centerRequest}
            data={data}
            selected={selected}
            searchMatches={searchMatches}
            renamingId={renamingId}
            onRenameFocused={() => setRenamingId(null)}
            onSelect={select}
            onOpenNode={(id) => {
              select(id);
              setView('documents');
            }}
            onRelationsChanged={relationsChanged}
            onOpenDocument={(id) => openDocument(id)}
            onAddDocument={(nodeId) => openOverlay('addingDocumentFor', nodeId)}
            onNew={(parentId) => setDialog({ kind: 'new', parentId })}
            onCreateAt={(position) =>
              setDialog({ kind: 'new', parentId: null, position })
            }
            onRename={renameNode}
            onMove={(node) =>
              setDialog({ kind: 'move', nodes: [node], bulk: false })
            }
            onDuplicate={(node) => setDialog({ kind: 'duplicate', node })}
            onDelete={(id) => void askDelete(id)}
            onBulkMove={() =>
              setDialog({
                kind: 'move',
                nodes: nodes.filter((node) => multiSelection.has(node.id)),
                bulk: true,
              })
            }
            onBulkSetType={(nodeType) => void bulkSetType(nodeType)}
            onBulkDelete={() => void askBulkDelete()}
            onValidate={(ids) => void validate(ids)}
            graphViews={graphViews}
            path={pathHighlight}
          />

          {(detail || activePath) && (
            <div className="right-pane">
              {activePath && (
                <PathPanel
                  fromTitle={index.byId.get(activePath.fromId)?.title ?? ''}
                  toTitle={index.byId.get(activePath.toId)?.title ?? ''}
                  steps={pathSteps}
                  maxDepth={PATH_MAX_DEPTH}
                  includeHierarchy={activePath.includeHierarchy}
                  onIncludeHierarchyChange={(includeHierarchy) =>
                    setPathQuery({ ...activePath, includeHierarchy })
                  }
                  titleOf={(id) => index.byId.get(id)?.title ?? ''}
                  edges={graph?.edges ?? []}
                  relationTypes={graph?.relationTypes ?? []}
                  hiddenCount={pathHiddenCount}
                  onSelect={(id) => select(id)}
                  onClose={() => setPathQuery(null)}
                />
              )}
              {detail && (
                <ErrorBoundary area="les propriétés du nœud">
                  <NodeProperties
                    key={`${detail.id}:${data.externalRevision}`}
                    node={detail}
                    allTags={data.tags}
                    nodes={nodes}
                    relationTypes={data.graph?.relationTypes ?? []}
                    relationsRevision={data.relationsRevision}
                    documentsRevision={documentsRevision}
                    onNavigate={select}
                    onNodeChanged={nodeChanged}
                    onTagsChanged={() => void data.refreshTags()}
                    onRelationsChanged={relationsChanged}
                    onOpenDocument={(id) => openDocument(id)}
                    onOpenDocumentOf={openDocument}
                    onDocumentsChanged={data.reloadDocuments}
                    onAddDocument={() =>
                      openOverlay('addingDocumentFor', detail.id)
                    }
                    onCodeAnchorsChanged={() => void staleNodes.refresh()}
                  />
                </ErrorBoundary>
              )}
            </div>
          )}
        </div>

        <WorkspaceDialogs
          workspace={workspace}
          data={data}
          index={index}
          selected={selected}
          dialog={dialog}
          overlays={overlays}
          onCloseDialog={() => setDialog(null)}
          onCloseOverlay={closeOverlay}
          onSelect={select}
          onWorkspaceChanged={onWorkspaceChanged}
          onWorkspaceDeleted={onDeleted}
          onRelationsChanged={relationsChanged}
          onCreateNode={(title, nodeType, parentId) =>
            void createNode(title, nodeType, parentId)
          }
          onMove={(moved, parentId, bulk) =>
            bulk ? void bulkMove(parentId) : void moveTo(moved[0]!, parentId)
          }
          onDuplicate={(node, includeChildren) =>
            void duplicate(node, includeChildren)
          }
          onDeleteNode={(node, strategy) => void deleteNode(node, strategy)}
          onBulkDelete={(ids, strategy) => void bulkDelete(ids, strategy)}
          onExportForLlm={(options) => void exportForLlm(options)}
          onCreateDocument={(nodeId, title, contentType, language) =>
            void createDocument(nodeId, title, contentType, language)
          }
          actions={actions}
        />
        {overlays.health && (
          <HealthDialog
            focus={overlays.health}
            onClose={() => closeOverlay('health')}
            onOpenNode={(id) => {
              closeOverlay('health');
              select(id);
            }}
            onOpenDocument={(documentId, nodeId) => {
              closeOverlay('health');
              openDocument(documentId, nodeId);
            }}
            onValidate={(ids) => void validate(ids)}
            onCodeAnchorsChanged={() => void staleNodes.refresh()}
            onCreateFromGap={(gap) => {
              closeOverlay('health');
              setDialog({
                kind: 'new',
                parentId: null,
                initialTitle: gap.query,
                gapKey: gap.key,
              });
            }}
          />
        )}
        {pathPickFrom !== null && (
          <CommandPalette
            actions={[]}
            nodes={paletteNodes.filter((node) => node.id !== pathPickFrom)}
            recentNodes={recentNodes.filter((node) => node.id !== pathPickFrom)}
            actionsOnly={false}
            label={`Chemin depuis « ${index.byId.get(pathPickFrom)?.title ?? ''} » vers…`}
            placeholder="Nœud d’arrivée…"
            onOpenNode={(toId) => {
              setPathQuery((current) => ({
                fromId: pathPickFrom,
                toId,
                includeHierarchy: current?.includeHierarchy ?? false,
              }));
              setView('graph');
            }}
            onClose={() => setPathPickFrom(null)}
          />
        )}
        {palette && (
          <CommandPalette
            actions={actions}
            nodes={paletteNodes}
            recentNodes={recentNodes}
            actionsOnly={palette.actionsOnly}
            onOpenNode={(id) => select(id)}
            onClose={() => setPalette(null)}
          />
        )}
      </div>
    </NodeLinksContext.Provider>
  );
}
