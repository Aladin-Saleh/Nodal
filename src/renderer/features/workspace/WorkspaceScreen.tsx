import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeType } from '../../../shared/domain';
import type { WorkspaceInfo } from '../../../shared/ipc-contract';
import type {
  ChildrenStrategy,
  NodeDeletionImpact,
  NodeDetail,
  NodeSummary,
  TagInfo,
} from '../../../shared/model';
import {
  useClient,
  useReportError,
  useRunner,
  useSaveTracker,
} from '../../app/context';
import { DocumentsPanel } from '../documents/DocumentsPanel';
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
import { TagManagerDialog } from '../tags/TagManagerDialog';
import { WorkspaceSettingsDialog } from './WorkspaceSettingsDialog';

type DialogState =
  | { kind: 'new'; parentId: string | null }
  | { kind: 'move'; node: NodeSummary }
  | { kind: 'duplicate'; node: NodeSummary }
  | { kind: 'delete'; node: NodeSummary; impact: NodeDeletionImpact }
  | { kind: 'tags' }
  | { kind: 'settings' };

export interface WorkspaceScreenProps {
  workspace: WorkspaceInfo;
  onWorkspaceChanged(workspace: WorkspaceInfo): void;
  onClose(): void;
  onDeleted(): void;
}

/**
 * Espace ouvert (§7) : arborescence à gauche, documents au centre,
 * propriétés à droite.
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
  const tracker = useSaveTracker();

  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  const index = useMemo(() => buildTreeIndex(nodes), [nodes]);
  const selected = selectedId ? (index.byId.get(selectedId) ?? null) : null;

  const refreshNodes = useCallback(
    () => client.call('node:list').then(setNodes, reportError),
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

  // --- Actions sur les nœuds -------------------------------------------------

  const createNode = async (title: string, nodeType: NodeType) => {
    if (dialog?.kind !== 'new') return;
    const { parentId } = dialog;
    setDialog(null);
    const created = await run(() =>
      client.call('node:create', { parentId, title, nodeType }),
    );
    if (!created) return;
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

  // --- Raccourcis clavier (§7.1) -------------------------------------------

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || dialog) return;
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
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, selectedId, tracker]);

  const siblings = selected ? siblingsOf(index, selected) : [];
  const siblingPosition = selected
    ? siblings.findIndex((sibling) => sibling.id === selected.id)
    : -1;

  return (
    <div className="workspace-screen">
      <header className="top-bar">
        <h1 className="workspace-name" title={workspace.filePath}>
          {workspace.name}
        </h1>
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
            onClick={() => setDialog({ kind: 'settings' })}
          >
            Paramètres
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Fermer l’espace
          </button>
        </div>
      </header>

      <div className="panes">
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
          />
        </nav>

        <main className="content-pane">
          {shownDetail && selected ? (
            <>
              <NodeHeader
                key={`${shownDetail.id}:${shownDetail.title}`}
                node={shownDetail}
                titleInput={titleInput}
                onNavigate={select}
                onRename={renameNode}
                onMove={() => setDialog({ kind: 'move', node: selected })}
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
            onNodeChanged={nodeChanged}
            onTagsChanged={() => void refreshTags()}
          />
        )}
      </div>

      {dialog?.kind === 'new' && (
        <NewNodeDialog
          parentTitle={
            dialog.parentId
              ? (index.byId.get(dialog.parentId)?.title ?? null)
              : null
          }
          onSubmit={(title, nodeType) => void createNode(title, nodeType)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveNodeDialog
          index={index}
          node={dialog.node}
          onSubmit={(parentId) => void moveTo(dialog.node, parentId)}
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
          node={dialog.node}
          impact={dialog.impact}
          busy={false}
          onSubmit={(strategy) => void deleteNode(dialog.node, strategy)}
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
  );
}
