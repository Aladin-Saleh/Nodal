import type { WorkspaceInfo } from '../../../shared/ipc-contract';
import type { SearchHit } from '../../../shared/model';
import { MenuButton } from '../../components/MenuButton';
import {
  actionById,
  menuItems,
  shortcutLabel,
  type AppAction,
} from '../commands/actions';
import { SearchBox } from '../search/SearchBox';
import { ReposMenu } from './ReposMenu';
import { ASSISTANT_MENU, WORKSPACE_MENU } from './workspace-actions';

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
  /** Terminal intégré affiché (bouton enfoncé). */
  terminalOpen: boolean;
  /** Registre des actions : boutons et menus Espace / Assistant IA. */
  actions: readonly AppAction[];
  /** Ouvre un terminal dans un repo (dossier de code) de l'espace. */
  onOpenTerminalIn(folder: string): void;
}

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
  terminalOpen,
  actions,
  onOpenTerminalIn,
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
        <ReposMenu actions={actions} onOpenTerminalIn={onOpenTerminalIn} />
        <MenuButton
          label="Espace"
          alignRight
          items={menuItems(actions, WORKSPACE_MENU, {
            danger: ['workspace.close'],
          })}
        >
          {exporting ? 'Export…' : 'Espace'}
        </MenuButton>
        <MenuButton
          label="Assistant IA"
          alignRight
          items={menuItems(actions, ASSISTANT_MENU)}
        >
          Assistant IA
        </MenuButton>
        {button('view.terminal', '>_', {
          'aria-label': 'Terminal',
          'aria-pressed': terminalOpen,
          className: 'secondary terminal-toggle',
        })}
        {button('app.help', '?', { 'aria-label': 'Aide (F1)' })}
      </div>
    </header>
  );
}
