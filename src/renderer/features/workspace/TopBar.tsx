import type { MouseEvent, RefObject } from 'react';
import type { WorkspaceInfo } from '../../../shared/ipc-contract';
import type { SearchHit } from '../../../shared/model';
import { SearchBox } from '../search/SearchBox';

export type ViewMode = 'documents' | 'graph';

export interface TopBarProps {
  workspace: WorkspaceInfo;
  searchInput: RefObject<HTMLInputElement | null>;
  onSearchResults(hits: SearchHit[] | null): void;
  onSelectNode(id: string): void;
  onOpenDocument(documentId: string, nodeId?: string): void;
  view: ViewMode;
  onViewChange(view: ViewMode): void;
  exporting: boolean;
  onTags(): void;
  onRelationTypes(): void;
  onExport(): void;
  onLlmExport(): void;
  onConnectAssistant(): void;
  onActivity(): void;
  onSettings(): void;
  onHelp(): void;
  onClose(): void;
}

/** Ferme le menu déroulant qui contient l'élément cliqué. */
const closeMenu = (event: MouseEvent<HTMLElement>) =>
  event.currentTarget.closest('details')?.removeAttribute('open');

/** En-tête de l'espace : nom, recherche, choix de la vue et actions. */
export function TopBar({
  workspace,
  searchInput,
  onSearchResults,
  onSelectNode,
  onOpenDocument,
  view,
  onViewChange,
  exporting,
  onTags,
  onRelationTypes,
  onExport,
  onLlmExport,
  onConnectAssistant,
  onActivity,
  onSettings,
  onHelp,
  onClose,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <h1 className="workspace-name" title={workspace.filePath}>
        {workspace.name}
      </h1>
      <SearchBox
        inputRef={searchInput}
        onResults={onSearchResults}
        onSelectNode={onSelectNode}
        onOpenDocument={onOpenDocument}
      />
      <div className="segmented" role="group" aria-label="Vue centrale">
        <button
          type="button"
          aria-pressed={view === 'documents'}
          onClick={() => onViewChange('documents')}
        >
          Documents
        </button>
        <button
          type="button"
          aria-pressed={view === 'graph'}
          onClick={() => onViewChange('graph')}
        >
          Graphe
        </button>
      </div>
      <div className="top-actions">
        <button type="button" className="secondary" onClick={onTags}>
          Tags
        </button>
        <button type="button" className="secondary" onClick={onRelationTypes}>
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
                closeMenu(event);
                onExport();
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
                closeMenu(event);
                onLlmExport();
              }}
            >
              Export pour LLM (TOON, fragments)…
            </button>
            <button
              type="button"
              role="menuitem"
              className="secondary"
              onClick={(event) => {
                closeMenu(event);
                onConnectAssistant();
              }}
            >
              Connecter un assistant IA (MCP)…
            </button>
          </div>
        </details>
        <button
          type="button"
          className="secondary"
          title="Modifications faites par un assistant IA (MCP)"
          onClick={onActivity}
        >
          Activité IA
        </button>
        <button type="button" className="secondary" onClick={onSettings}>
          Paramètres
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="Aide (F1)"
          title="Aide (F1)"
          onClick={onHelp}
        >
          ?
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Fermer l’espace
        </button>
      </div>
    </header>
  );
}
