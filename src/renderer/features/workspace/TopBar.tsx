import type { MouseEvent } from 'react';
import type { WorkspaceInfo } from '../../../shared/ipc-contract';
import type { SearchHit } from '../../../shared/model';
import { actionById, shortcutLabel, type AppAction } from '../commands/actions';
import { SearchBox } from '../search/SearchBox';

export type ViewMode = 'documents' | 'graph';

export interface TopBarProps {
  workspace: WorkspaceInfo;
  /** Demande de focus sur la recherche (Ctrl+F) : incrémentée à chaque fois. */
  searchFocus: number;
  onSearchResults(hits: SearchHit[] | null): void;
  onSelectNode(id: string): void;
  onOpenDocument(documentId: string, nodeId?: string): void;
  view: ViewMode;
  onViewChange(view: ViewMode): void;
  exporting: boolean;
  /** Registre des actions : boutons et menu Exporter. */
  actions: readonly AppAction[];
}

/** Ferme le menu déroulant qui contient l'élément cliqué. */
const closeMenu = (event: MouseEvent<HTMLElement>) =>
  event.currentTarget.closest('details')?.removeAttribute('open');

/** En-tête de l'espace : nom, recherche, choix de la vue et actions. */
export function TopBar({
  workspace,
  searchFocus,
  onSearchResults,
  onSelectNode,
  onOpenDocument,
  view,
  onViewChange,
  exporting,
  actions,
}: TopBarProps) {
  /** Bouton d'une action du registre (libellé court possible). */
  const button = (id: string, label?: string, extra: object = {}) => {
    const action = actionById(actions, id);
    if (!action) return null;
    const shortcut = shortcutLabel(action);
    return (
      <button
        type="button"
        className="secondary"
        disabled={!action.enabled}
        title={shortcut ? `${action.label} (${shortcut})` : undefined}
        onClick={action.run}
        {...extra}
      >
        {label ?? action.label}
      </button>
    );
  };
  /** Élément du menu Exporter : ferme le menu puis lance l'action. */
  const menuItem = (id: string) => {
    const action = actionById(actions, id);
    if (!action) return null;
    return (
      <button
        type="button"
        role="menuitem"
        className="secondary"
        disabled={!action.enabled}
        onClick={(event) => {
          closeMenu(event);
          action.run();
        }}
      >
        {action.label}
      </button>
    );
  };
  return (
    <header className="top-bar">
      <div className="nav-buttons" role="group" aria-label="Historique">
        {button('nav.back', '←', { 'aria-label': 'Nœud précédent' })}
        {button('nav.forward', '→', { 'aria-label': 'Nœud suivant' })}
      </div>
      <h1 className="workspace-name" title={workspace.filePath}>
        {workspace.name}
      </h1>
      <SearchBox
        focusRequest={searchFocus}
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
        {button('workspace.tags')}
        {button('workspace.relationTypes')}
        <details className="export-menu">
          <summary
            className={exporting ? 'disabled' : undefined}
            aria-disabled={exporting}
          >
            {exporting ? 'Export…' : 'Exporter ▾'}
          </summary>
          <div className="export-menu-panel" role="menu">
            {menuItem('workspace.export')}
            {menuItem('workspace.exportLlm')}
            {menuItem('workspace.mcp')}
          </div>
        </details>
        {button('workspace.activity')}
        {button('workspace.settings', 'Paramètres')}
        {button('app.help', '?', { 'aria-label': 'Aide (F1)' })}
        {button('workspace.close')}
      </div>
    </header>
  );
}
