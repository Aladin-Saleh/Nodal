import type { RefObject } from 'react';
import type { NodeType } from '../../../shared/domain';
import type { NodeSummary } from '../../../shared/model';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { DocumentsPanel } from '../documents/DocumentsPanel';
import { GraphPanel } from '../graph/GraphPanel';
import { NodeHeader } from '../nodes/NodeHeader';
import type { ViewMode } from './TopBar';
import type { WorkspaceData } from './useWorkspaceData';

export interface CenterPaneProps {
  view: ViewMode;
  /** Centrer ce nœud dans le graphe (nouvelle demande à chaque nonce). */
  centerRequest: { id: string; nonce: number } | null;
  data: WorkspaceData;
  selected: NodeSummary | null;
  searchMatches: ReadonlySet<string> | null;
  titleInput: RefObject<HTMLInputElement | null>;
  onSelect(id: string | null): void;
  /** Double-clic sur un nœud du graphe : sa fiche documentaire. */
  onOpenNode(id: string): void;
  onRelationsChanged(): void;
  onOpenDocument(documentId: string): void;
  onAddDocument(nodeId: string): void;
  onNew(parentId: string | null): void;
  onCreateAt(position: { x: number; y: number; z: number }): void;
  onRename(title: string): Promise<boolean>;
  onMove(node: NodeSummary): void;
  onDuplicate(node: NodeSummary): void;
  onDelete(id: string): void;
  onBulkMove(): void;
  onBulkSetType(nodeType: NodeType): void;
  onBulkDelete(): void;
}

/** Zone centrale : graphe, ou documents du nœud sélectionné. */
export function CenterPane({
  view,
  centerRequest,
  data,
  selected,
  searchMatches,
  titleInput,
  onSelect,
  onOpenNode,
  onRelationsChanged,
  onOpenDocument,
  onAddDocument,
  onNew,
  onCreateAt,
  onRename,
  onMove,
  onDuplicate,
  onDelete,
  onBulkMove,
  onBulkSetType,
  onBulkDelete,
}: CenterPaneProps) {
  const { nodes, graph, tags, detail } = data;
  return (
    <main
      className={view === 'graph' ? 'content-pane graph-mode' : 'content-pane'}
    >
      {view === 'graph' && nodes.length > 0 ? (
        graph && (
          <ErrorBoundary area="le graphe">
            <GraphPanel
              graph={graph}
              centerRequest={centerRequest}
              nodes={nodes}
              tags={tags}
              onSelect={onSelect}
              onOpen={onOpenNode}
              onPositionsSaved={data.positionsSaved}
              onRelationsChanged={onRelationsChanged}
              selectedDocuments={detail?.documents ?? null}
              searchMatches={searchMatches}
              onOpenDocument={onOpenDocument}
              onAddDocument={onAddDocument}
              onBulkMove={onBulkMove}
              onBulkSetType={onBulkSetType}
              onBulkDelete={onBulkDelete}
              onCreateAt={onCreateAt}
            />
          </ErrorBoundary>
        )
      ) : detail && selected ? (
        <>
          <NodeHeader
            key={`${detail.id}:${detail.title}`}
            node={detail}
            titleInput={titleInput}
            onNavigate={onSelect}
            onRename={onRename}
            onMove={() => onMove(selected)}
            onDuplicate={() => onDuplicate(selected)}
            onDelete={() => onDelete(selected.id)}
          />
          <ErrorBoundary area="les documents">
            <DocumentsPanel
              key={detail.id}
              nodeId={detail.id}
              documents={detail.documents}
              revision={data.externalRevision}
              onChanged={data.refreshDetail}
            />
          </ErrorBoundary>
        </>
      ) : (
        <div className="empty-state">
          <p className="muted">
            {nodes.length === 0
              ? 'Cet espace est vide.'
              : 'Sélectionnez un nœud dans l’arborescence.'}
          </p>
          {nodes.length === 0 && (
            <button type="button" onClick={() => onNew(null)}>
              Créer un premier nœud
            </button>
          )}
        </div>
      )}
    </main>
  );
}
