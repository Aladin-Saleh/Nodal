import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NodalError } from '../../../shared/errors';
import type { ContentType, NodeType } from '../../../shared/domain';
import type { WorkspaceInfo } from '../../../shared/ipc-contract';
import type {
  BulkDeletionImpact,
  ChildrenStrategy,
  LlmExportOptions,
  GraphData,
  NodeDeletionImpact,
  NodeDetail,
  NodePosition,
  NodeSummary,
  SearchHit,
  TagInfo,
} from '../../../shared/model';
import {
  useClient,
  useReportError,
  useReportInfo,
  useRunner,
  useSaveTracker,
} from '../../app/context';
import { DocumentEditorDialog } from '../documents/DocumentEditorDialog';
import {
  DocumentsPanel,
  NewDocumentDialog,
  type Language,
} from '../documents/DocumentsPanel';
import { GraphPanel } from '../graph/GraphPanel';
import {
  DeleteNodeDialog,
  DuplicateNodeDialog,
  MoveNodeDialog,
  NewNodeDialog,
} from '../nodes/NodeDialogs';
import { NodeHeader } from '../nodes/NodeHeader';
import { NodeProperties } from '../nodes/NodeProperties';
import { NodeTree } from '../nodes/NodeTree';
import { ancestorIds, buildTreeIndex, siblingsOf } from '../nodes/tree';
import { RelationTypeManagerDialog } from '../relations/RelationTypeManagerDialog';
import { SearchBox } from '../search/SearchBox';
import { NodeLinkContext } from '../editor/previews';
import { LlmExportDialog } from './PortabilityDialogs';
import { TagManagerDialog } from '../tags/TagManagerDialog';
import { WorkspaceSettingsDialog } from './WorkspaceSettingsDialog';

type DialogState =
  | {
      kind: 'new';
      parentId: string | null;
      /** Double-clic dans le graphe : position 3D et choix du parent. */
      position?: { x: number; y: number; z: number };
    }
  | { kind: 'move'; nodes: NodeSummary[]; bulk: boolean }
  | { kind: 'duplicate'; node: NodeSummary }
  | { kind: 'delete'; node: NodeSummary; impact: NodeDeletionImpact }
  | { kind: 'bulkDelete'; ids: string[]; impact: BulkDeletionImpact }
  | { kind: 'tags' }
  | { kind: 'relationTypes' }
  | { kind: 'settings' };

type ViewMode = 'documents' | 'graph';
export interface WorkspaceScreenProps {
  workspace: WorkspaceInfo;
  onWorkspaceChanged(workspace: WorkspaceInfo): void;
  onClose(): void;
  onDeleted(): void;
}

/**
 * Espace ouvert (§7) : arborescence à gauche, documents ou graphe au centre,
 * propriétés et relations à droite.
 */
export function WorkspaceScreen({
  workspace,
  onWorkspaceChanged,
  onClose,
  onDeleted,
}: WorkspaceScreenProps) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const reportInfo = useReportInfo();
  const tracker = useSaveTracker();

  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  // La vue Graphe est la vue par défaut à l'ouverture d'un espace.
  const [view, setView] = useState<ViewMode>('graph');
  const [relationsRevision, setRelationsRevision] = useState(0);
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [editingDocumentId, setEditingDocumentId] = useState<string | null>(
    null,
  );
  const [addingDocumentFor, setAddingDocumentFor] = useState<string | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);
  const [llmExportOpen, setLlmExportOpen] = useState(false);
  const [multiSelection, setMultiSelection] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const toggleMulti = (id: string) => {
    const next = new Set(multiSelection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setMultiSelection(next);
  };
  const searchInput = useRef<HTMLInputElement>(null);
  const searchMatches = useMemo(
    () => (searchHits ? new Set(searchHits.map((hit) => hit.nodeId)) : null),
    [searchHits],
  );

  const titleInput = useRef<HTMLInputElement>(null);

  const index = useMemo(() => buildTreeIndex(nodes), [nodes]);
  const selected = selectedId ? (index.byId.get(selectedId) ?? null) : null;

  /** Recharge l'arborescence et le graphe (données légères). */
  const refreshNodes = useCallback(
    () =>
      Promise.all([client.call('node:list'), client.call('graph:get')]).then(
        ([list, graphData]) => {
          setNodes(list);
          setGraph(graphData);
        },
        reportError,
      ),
    [client, reportError],
  );
  const refreshTags = useCallback(
    () => client.call('tag:list').then(setTags, reportError),
    [client, reportError],
  );

  useEffect(() => {
    void refreshNodes();
    void refreshTags();
  }, [refreshNodes, refreshTags]);

  // Seule la réponse à la dernière demande est prise en compte.
  const detailRequest = useRef(0);
  const selectedRef = useRef<string | null>(null);

  const loadDetail = useCallback(
    (id: string | null) => {
      const request = ++detailRequest.current;
      if (!id) {
        setDetail(null);
        return;
      }
      client.call('node:get', { id }).then(
        (loaded) => {
          if (request === detailRequest.current) setDetail(loaded);
        },
        (error: unknown) => {
          if (request !== detailRequest.current) return;
          setDetail(null);
          reportError(error);
        },
      );
    },
    [client, reportError],
  );

  const refreshDetail = useCallback(
    () => loadDetail(selectedRef.current),
    [loadDetail],
  );

  const select = useCallback(
    (id: string | null) => {
      selectedRef.current = id;
      setSelectedId(id);
      loadDetail(id);
      if (!id) return;
      // Déplier les ancêtres pour que le nœud soit visible dans l'arbre.
      const ancestors = ancestorIds(index, id);
      if (ancestors.some((ancestor) => !expanded.has(ancestor))) {
        setExpanded(new Set([...expanded, ...ancestors]));
      }
    },
    [index, expanded, loadDetail],
  );

  // La fiche affichée doit correspondre au nœud sélectionné.
  const shownDetail = detail?.id === selectedId ? detail : null;

  const toggle = (id: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(id);
    else next.delete(id);
    setExpanded(next);
  };

  const nodeChanged = () => {
    void refreshNodes();
    refreshDetail();
  };

  const relationsChanged = () => {
    setRelationsRevision((revision) => revision + 1);
    nodeChanged();
  };

  /** Positions déjà enregistrées : mise à jour locale, sans recharger. */
  const positionsSaved = (positions: NodePosition[]) => {
    const byId = new Map(positions.map((position) => [position.id, position]));
    setGraph(
      (current) =>
        current && {
          ...current,
          nodes: current.nodes.map((node) => {
            const position = byId.get(node.id);
            // Les trois coordonnées : un z manquant ferait replacer le nœud.
            return position
              ? { ...node, x: position.x, y: position.y, z: position.z }
              : node;
          }),
        },
    );
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
    setDialog(null);
    const created = await run(() =>
      client.call('node:create', { parentId, title, nodeType }),
    );
    if (!created) return;
    if (position) {
      // Le nœud apparaît là où l'on a double-cliqué.
      await run(() =>
        client.call('graph:savePositions', {
          positions: [{ id: created.id, ...position }],
        }),
      );
    }
    await refreshNodes();
    if (parentId) setExpanded((current) => new Set([...current, parentId]));
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
    if (parentId) setExpanded((current) => new Set([...current, parentId]));
    nodeChanged();
  };

  const bulkMove = async (parentId: string | null) => {
    const ids = [...multiSelection];
    setDialog(null);
    const done = await run(() =>
      client.call('node:moveMany', { ids, parentId }),
    );
    if (done === undefined) return;
    if (parentId) setExpanded((current) => new Set([...current, parentId]));
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
    setMultiSelection(new Set());
    if (selectedId && ids.includes(selectedId)) select(null);
    void refreshNodes();
    void refreshTags();
    refreshDetail();
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
    await refreshNodes();
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
    void refreshNodes();
    void refreshTags();
  };

  const renameNode = async (title: string) => {
    if (!shownDetail) return false;
    const { id } = shownDetail;
    const updated = await run(() => client.call('node:update', { id, title }));
    if (updated) nodeChanged();
    return Boolean(updated);
  };

  // --- Documents depuis le graphe ou la recherche --------------------------

  const openDocument = (documentId: string, nodeId?: string) => {
    if (nodeId && nodeId !== selectedId) select(nodeId);
    setEditingDocumentId(documentId);
  };

  const createDocument = async (
    nodeId: string,
    title: string,
    contentType: ContentType,
    language: Language | null,
  ) => {
    setAddingDocumentFor(null);
    const created = await run(() =>
      client.call('document:create', { nodeId, title, contentType, language }),
    );
    if (!created) return;
    refreshDetail();
    setEditingDocumentId(created.id);
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
    setLlmExportOpen(false);
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
  const openNodeByTitle = (title: string) => {
    const wanted = title.trim().toLocaleLowerCase();
    const target = nodes.find(
      (node) => node.title.toLocaleLowerCase() === wanted,
    );
    if (!target) {
      reportError(
        new NodalError('NOT_FOUND', `Aucun nœud intitulé « ${title} ».`),
      );
      return;
    }
    setEditingDocumentId(null);
    select(target.id);
  };

  const showSearchResults = (hits: SearchHit[] | null) => {
    setSearchHits(hits);
    if (!hits || hits.length === 0) return;
    // Déplier l'arborescence jusqu'aux nœuds trouvés.
    const ancestors = hits.flatMap((hit) => ancestorIds(index, hit.nodeId));
    if (ancestors.some((id) => !expanded.has(id))) {
      setExpanded(new Set([...expanded, ...ancestors]));
    }
  };

  // --- Raccourcis clavier (§7.1) -------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modalOpen = dialog || editingDocumentId || addingDocumentFor;
      if (!(event.ctrlKey || event.metaKey) || modalOpen) return;
      const key = event.key.toLowerCase();
      if (key === 'n') {
        event.preventDefault();
        setDialog({
          kind: 'new',
          parentId: event.shiftKey ? null : (selectedId ?? null),
        });
      } else if (key === 's') {
        event.preventDefault();
        void tracker.flushAll();
      } else if (key === 'f' || key === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, editingDocumentId, addingDocumentFor, selectedId, tracker]);

  const siblings = selected ? siblingsOf(index, selected) : [];
  const siblingPosition = selected
    ? siblings.findIndex((sibling) => sibling.id === selected.id)
    : -1;

  return (
    <NodeLinkContext.Provider value={openNodeByTitle}>
      <div className="workspace-screen">
        <header className="top-bar">
          <h1 className="workspace-name" title={workspace.filePath}>
            {workspace.name}
          </h1>
          <SearchBox
            inputRef={searchInput}
            onResults={showSearchResults}
            onSelectNode={(id) => select(id)}
            onOpenDocument={openDocument}
          />
          <div className="segmented" role="group" aria-label="Vue centrale">
            <button
              type="button"
              aria-pressed={view === 'documents'}
              onClick={() => setView('documents')}
            >
              Documents
            </button>
            <button
              type="button"
              aria-pressed={view === 'graph'}
              onClick={() => setView('graph')}
            >
              Graphe
            </button>
          </div>
          <div className="top-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setDialog({ kind: 'tags' })}
            >
              Tags
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setDialog({ kind: 'relationTypes' })}
            >
              Types de relations
            </button>
            <details className="export-menu">
              <summary
                className={exporting ? 'disabled' : undefined}
                aria-disabled={exporting}
              >
                {exporting ? 'Export…' : 'Exporter ▾'}
              </summary>
              <div className="export-menu-panel" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="secondary"
                  disabled={exporting}
                  onClick={(event) => {
                    event.currentTarget
                      .closest('details')
                      ?.removeAttribute('open');
                    void exportWorkspace();
                  }}
                >
                  Export portable (dossier + manifest)
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="secondary"
                  disabled={exporting}
                  onClick={(event) => {
                    event.currentTarget
                      .closest('details')
                      ?.removeAttribute('open');
                    setLlmExportOpen(true);
                  }}
                >
                  Export pour LLM (TOON, fragments)…
                </button>
              </div>
            </details>
            <button
              type="button"
              className="secondary"
              onClick={() => setDialog({ kind: 'settings' })}
            >
              Paramètres
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Fermer l’espace
            </button>
          </div>
        </header>

        <div className={shownDetail ? 'panes' : 'panes no-properties'}>
          <nav className="tree-pane" aria-label="Navigation">
            <div className="toolbar" aria-label="Actions sur les nœuds">
              <button
                type="button"
                title="Nouveau nœud racine (Ctrl+Maj+N)"
                onClick={() => setDialog({ kind: 'new', parentId: null })}
              >
                + Racine
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!selected}
                title="Nouveau sous-nœud (Ctrl+N)"
                onClick={() => setDialog({ kind: 'new', parentId: selectedId })}
              >
                + Enfant
              </button>
              <button
                type="button"
                className="secondary"
                disabled={siblingPosition <= 0}
                aria-label="Monter le nœud"
                title="Monter"
                onClick={() => shift(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  siblingPosition === -1 ||
                  siblingPosition === siblings.length - 1
                }
                aria-label="Descendre le nœud"
                title="Descendre"
                onClick={() => shift(1)}
              >
                ↓
              </button>
            </div>
            <NodeTree
              index={index}
              expanded={expanded}
              selectedId={selectedId}
              onSelect={select}
              onToggle={toggle}
              onDelete={(id) => void askDelete(id)}
              onRename={() => titleInput.current?.focus()}
              highlighted={searchMatches}
              multiSelection={multiSelection}
              onToggleMulti={toggleMulti}
            />
          </nav>

          <main
            className={
              view === 'graph' ? 'content-pane graph-mode' : 'content-pane'
            }
          >
            {view === 'graph' && nodes.length > 0 ? (
              graph && (
                <GraphPanel
                  graph={graph}
                  nodes={nodes}
                  tags={tags}
                  selectedId={selectedId}
                  onSelect={select}
                  onOpen={(id) => {
                    select(id);
                    setView('documents');
                  }}
                  onPositionsSaved={positionsSaved}
                  onRelationsChanged={relationsChanged}
                  selectedDocuments={shownDetail?.documents ?? null}
                  searchMatches={searchMatches}
                  onOpenDocument={(id) => openDocument(id)}
                  onAddDocument={(nodeId) => setAddingDocumentFor(nodeId)}
                  multiSelection={multiSelection}
                  onToggleSelect={toggleMulti}
                  onSetMultiSelection={setMultiSelection}
                  onBulkMove={() =>
                    setDialog({
                      kind: 'move',
                      nodes: nodes.filter((node) =>
                        multiSelection.has(node.id),
                      ),
                      bulk: true,
                    })
                  }
                  onBulkSetType={(nodeType) => void bulkSetType(nodeType)}
                  onBulkDelete={() => void askBulkDelete()}
                  onCreateAt={(position) =>
                    setDialog({ kind: 'new', parentId: null, position })
                  }
                />
              )
            ) : shownDetail && selected ? (
              <>
                <NodeHeader
                  key={`${shownDetail.id}:${shownDetail.title}`}
                  node={shownDetail}
                  titleInput={titleInput}
                  onNavigate={select}
                  onRename={renameNode}
                  onMove={() =>
                    setDialog({ kind: 'move', nodes: [selected], bulk: false })
                  }
                  onDuplicate={() =>
                    setDialog({ kind: 'duplicate', node: selected })
                  }
                  onDelete={() => void askDelete(selected.id)}
                />
                <DocumentsPanel
                  key={shownDetail.id}
                  nodeId={shownDetail.id}
                  documents={shownDetail.documents}
                  onChanged={refreshDetail}
                />
              </>
            ) : (
              <div className="empty-state">
                <p className="muted">
                  {nodes.length === 0
                    ? 'Cet espace est vide.'
                    : 'Sélectionnez un nœud dans l’arborescence.'}
                </p>
                {nodes.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: 'new', parentId: null })}
                  >
                    Créer un premier nœud
                  </button>
                )}
              </div>
            )}
          </main>

          {shownDetail && (
            <NodeProperties
              key={shownDetail.id}
              node={shownDetail}
              allTags={tags}
              nodes={nodes}
              relationTypes={graph?.relationTypes ?? []}
              relationsRevision={relationsRevision}
              onNavigate={select}
              onNodeChanged={nodeChanged}
              onTagsChanged={() => void refreshTags()}
              onRelationsChanged={relationsChanged}
              onOpenDocument={(id) => openDocument(id)}
              onAddDocument={() => setAddingDocumentFor(shownDetail.id)}
            />
          )}
        </div>

        {llmExportOpen && (
          <LlmExportDialog
            selected={selected}
            onSubmit={(options) => void exportForLlm(options)}
            onCancel={() => setLlmExportOpen(false)}
          />
        )}
        {editingDocumentId && (
          <DocumentEditorDialog
            documentId={editingDocumentId}
            onChanged={refreshDetail}
            onClose={() => {
              setEditingDocumentId(null);
              refreshDetail();
            }}
          />
        )}
        {addingDocumentFor && (
          <NewDocumentDialog
            onSubmit={(title, contentType, language) =>
              void createDocument(
                addingDocumentFor,
                title,
                contentType,
                language,
              )
            }
            onCancel={() => setAddingDocumentFor(null)}
          />
        )}
        {dialog?.kind === 'relationTypes' && (
          <RelationTypeManagerDialog
            relationTypes={graph?.relationTypes ?? []}
            onChanged={() => void refreshNodes()}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'new' && (
          <NewNodeDialog
            parentTitle={
              dialog.parentId
                ? (index.byId.get(dialog.parentId)?.title ?? null)
                : null
            }
            parentChoice={
              dialog.position ? { index, parentId: dialog.parentId } : undefined
            }
            onSubmit={(title, nodeType, parentId) =>
              void createNode(title, nodeType, parentId)
            }
            onCancel={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'move' && (
          <MoveNodeDialog
            index={index}
            nodes={dialog.nodes}
            onSubmit={(parentId) =>
              dialog.bulk
                ? void bulkMove(parentId)
                : void moveTo(dialog.nodes[0]!, parentId)
            }
            onCancel={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'duplicate' && (
          <DuplicateNodeDialog
            node={dialog.node}
            hasChildren={(index.children.get(dialog.node.id)?.length ?? 0) > 0}
            onSubmit={(includeChildren) =>
              void duplicate(dialog.node, includeChildren)
            }
            onCancel={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'delete' && (
          <DeleteNodeDialog
            title={`Supprimer « ${dialog.node.title} » ?`}
            impact={dialog.impact}
            busy={false}
            onSubmit={(strategy) => void deleteNode(dialog.node, strategy)}
            onCancel={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'bulkDelete' && (
          <DeleteNodeDialog
            title={`Supprimer ${dialog.impact.nodeCount} nœuds ?`}
            impact={dialog.impact}
            busy={false}
            onSubmit={(strategy) => void bulkDelete(dialog.ids, strategy)}
            onCancel={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'tags' && (
          <TagManagerDialog
            tags={tags}
            onChanged={() => {
              void refreshTags();
              refreshDetail();
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog?.kind === 'settings' && (
          <WorkspaceSettingsDialog
            workspace={workspace}
            onUpdated={onWorkspaceChanged}
            onDeleted={onDeleted}
            onClose={() => setDialog(null)}
          />
        )}
      </div>
    </NodeLinkContext.Provider>
  );
}
