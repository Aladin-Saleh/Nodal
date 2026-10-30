import type { ContentType, NodeType } from '../../../shared/domain';
import type { WorkspaceInfo } from '../../../shared/ipc-contract';
import type {
  BulkDeletionImpact,
  ChildrenStrategy,
  LlmExportOptions,
  NodeDeletionImpact,
  NodeSummary,
} from '../../../shared/model';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { DocumentEditorDialog } from '../documents/DocumentEditorDialog';
import { NewDocumentDialog, type Language } from '../documents/DocumentsPanel';
import {
  DeleteNodeDialog,
  DuplicateNodeDialog,
  MoveNodeDialog,
  NewNodeDialog,
} from '../nodes/NodeDialogs';
import type { TreeIndex } from '../nodes/tree';
import { RelationTypeManagerDialog } from '../relations/RelationTypeManagerDialog';
import { TagManagerDialog } from '../tags/TagManagerDialog';
import { AssistantActivityDialog } from './AssistantActivityDialog';
import { HelpDialog } from './HelpDialog';
import { McpDialog } from './McpDialog';
import { LlmExportDialog } from './PortabilityDialogs';
import type { WorkspaceData } from './useWorkspaceData';
import { WorkspaceSettingsDialog } from './WorkspaceSettingsDialog';

export type DialogState =
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

/** Fenêtres secondaires ouvertes en dehors des dialogues de nœud. */
export interface Overlays {
  help: boolean;
  llmExport: boolean;
  mcp: boolean;
  activity: boolean;
  editingDocumentId: string | null;
  addingDocumentFor: string | null;
}

export const NO_OVERLAYS: Overlays = {
  help: false,
  llmExport: false,
  mcp: false,
  activity: false,
  editingDocumentId: null,
  addingDocumentFor: null,
};

export interface WorkspaceDialogsProps {
  workspace: WorkspaceInfo;
  data: WorkspaceData;
  index: TreeIndex;
  selected: NodeSummary | null;
  dialog: DialogState | null;
  overlays: Overlays;
  onCloseDialog(): void;
  onCloseOverlay(name: keyof Overlays): void;
  onSelect(id: string): void;
  onWorkspaceChanged(workspace: WorkspaceInfo): void;
  onWorkspaceDeleted(): void;
  onRelationsChanged(): void;
  onCreateNode(
    title: string,
    nodeType: NodeType,
    parentId: string | null,
  ): void;
  onMove(nodes: NodeSummary[], parentId: string | null, bulk: boolean): void;
  onDuplicate(node: NodeSummary, includeChildren: boolean): void;
  onDeleteNode(node: NodeSummary, strategy: ChildrenStrategy): void;
  onBulkDelete(ids: string[], strategy: ChildrenStrategy): void;
  onExportForLlm(options: LlmExportOptions): void;
  onCreateDocument(
    nodeId: string,
    title: string,
    contentType: ContentType,
    language: Language | null,
  ): void;
}

/** Dialogues et fenêtres de l'espace ouvert. */
export function WorkspaceDialogs({
  workspace,
  data,
  index,
  selected,
  dialog,
  overlays,
  onCloseDialog,
  onCloseOverlay,
  onSelect,
  onWorkspaceChanged,
  onWorkspaceDeleted,
  onRelationsChanged,
  onCreateNode,
  onMove,
  onDuplicate,
  onDeleteNode,
  onBulkDelete,
  onExportForLlm,
  onCreateDocument,
}: WorkspaceDialogsProps) {
  const relationTypes = data.graph?.relationTypes ?? [];
  return (
    <>
      {overlays.help && <HelpDialog onClose={() => onCloseOverlay('help')} />}
      {overlays.llmExport && (
        <LlmExportDialog
          selected={selected}
          onSubmit={onExportForLlm}
          onCancel={() => onCloseOverlay('llmExport')}
        />
      )}
      {overlays.activity && (
        <AssistantActivityDialog
          key={data.externalRevision}
          onNavigate={(id) => {
            onCloseOverlay('activity');
            onSelect(id);
          }}
          onChanged={() => {
            void data.refreshTags();
            onRelationsChanged();
          }}
          onClose={() => onCloseOverlay('activity')}
        />
      )}
      {overlays.mcp && (
        <McpDialog
          workspaceName={workspace.name}
          workspaceFile={workspace.filePath}
          onClose={() => onCloseOverlay('mcp')}
        />
      )}
      {overlays.editingDocumentId && (
        <ErrorBoundary area="l’éditeur de document">
          <DocumentEditorDialog
            documentId={overlays.editingDocumentId}
            revision={data.externalRevision}
            onChanged={data.refreshDetail}
            onClose={() => {
              onCloseOverlay('editingDocumentId');
              data.refreshDetail();
            }}
          />
        </ErrorBoundary>
      )}
      {overlays.addingDocumentFor && (
        <NewDocumentDialog
          onSubmit={(title, contentType, language) =>
            onCreateDocument(
              overlays.addingDocumentFor!,
              title,
              contentType,
              language,
            )
          }
          onCancel={() => onCloseOverlay('addingDocumentFor')}
        />
      )}
      {dialog?.kind === 'relationTypes' && (
        <RelationTypeManagerDialog
          relationTypes={relationTypes}
          onChanged={() => void data.refreshNodes()}
          onClose={onCloseDialog}
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
          onSubmit={onCreateNode}
          onCancel={onCloseDialog}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveNodeDialog
          index={index}
          nodes={dialog.nodes}
          onSubmit={(parentId) => onMove(dialog.nodes, parentId, dialog.bulk)}
          onCancel={onCloseDialog}
        />
      )}
      {dialog?.kind === 'duplicate' && (
        <DuplicateNodeDialog
          node={dialog.node}
          hasChildren={(index.children.get(dialog.node.id)?.length ?? 0) > 0}
          onSubmit={(includeChildren) =>
            onDuplicate(dialog.node, includeChildren)
          }
          onCancel={onCloseDialog}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteNodeDialog
          title={`Supprimer « ${dialog.node.title} » ?`}
          impact={dialog.impact}
          busy={false}
          onSubmit={(strategy) => onDeleteNode(dialog.node, strategy)}
          onCancel={onCloseDialog}
        />
      )}
      {dialog?.kind === 'bulkDelete' && (
        <DeleteNodeDialog
          title={`Supprimer ${dialog.impact.nodeCount} nœuds ?`}
          impact={dialog.impact}
          busy={false}
          onSubmit={(strategy) => onBulkDelete(dialog.ids, strategy)}
          onCancel={onCloseDialog}
        />
      )}
      {dialog?.kind === 'tags' && (
        <TagManagerDialog
          tags={data.tags}
          onChanged={() => {
            void data.refreshTags();
            data.refreshDetail();
          }}
          onClose={onCloseDialog}
        />
      )}
      {dialog?.kind === 'settings' && (
        <WorkspaceSettingsDialog
          workspace={workspace}
          onUpdated={onWorkspaceChanged}
          onDeleted={onWorkspaceDeleted}
          onClose={onCloseDialog}
        />
      )}
    </>
  );
}
