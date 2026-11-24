/**
 * Actions d'un espace ouvert, décrites une fois pour la palette de commandes,
 * les menus (barre supérieure, menu contextuel de l'arbre), les raccourcis
 * clavier et l'aide. Les effets sont fournis par l'écran d'espace.
 */
import type { NodeSummary } from '../../../shared/model';
import { MENU_SEPARATOR as SEP, type AppAction } from '../commands/actions';
import type { ViewMode } from './TopBar';

/** Menu « Espace » de la barre supérieure. */
export const WORKSPACE_MENU = [
  'workspace.tags',
  'workspace.relationTypes',
  'workspace.templates',
  'workspace.settings',
  SEP,
  'workspace.quickCapture',
  'workspace.inbox',
  'workspace.health',
  SEP,
  'workspace.importMarkdown',
  'workspace.export',
  'workspace.exportLlm',
  SEP,
  'app.preferences',
  'workspace.close',
];

/** Menu « Assistant IA » de la barre supérieure. */
export const ASSISTANT_MENU = [
  'workspace.mcp',
  'workspace.activity',
  'workspace.gaps',
];

/**
 * Actions d'un nœud : menu contextuel de l'arbre et menu « ⋯ » de sa fiche
 * (les inactives sont omises).
 */
export const NODE_MENU = [
  'node.newChild',
  'node.addDocument',
  'node.rename',
  'node.validate',
  SEP,
  'node.center',
  'node.pathTo',
  'node.impact',
  'node.toggleHidden',
  'node.solo',
  SEP,
  'node.move',
  'node.duplicate',
  'node.delete',
];

/** Ce que l'écran d'espace sait faire ; chaque action en appelle un. */
export interface WorkspaceCommands {
  newNode(parentId: string | null): void;
  rename(id: string): void;
  addDocument(id: string): void;
  toggleHidden(id: string): void;
  toggleSolo(id: string): void;
  showAll(): void;
  center(id: string): void;
  /** « Chemin vers… » : choisir le nœud d'arrivée depuis ce nœud. */
  pathFrom(id: string): void;
  /** Ce qui dépend de ce nœud. */
  impact(id: string): void;
  move(node: NodeSummary): void;
  duplicate(node: NodeSummary): void;
  validate(id: string): void;
  delete(id: string): void;
  setView(view: ViewMode): void;
  /** Applique une vue graphe enregistrée (et affiche le graphe). */
  applyView(id: string): void;
  /** Historique de navigation : précédent (-1) ou suivant (1). */
  navigate(direction: -1 | 1): void;
  focusSearch(): void;
  /** Affiche ou masque le terminal intégré. */
  toggleTerminal(): void;
  openPalette(actionsOnly: boolean): void;
  save(): void;
  tags(): void;
  /** Modèles de documents de l'espace. */
  templates(): void;
  relationTypes(): void;
  exportPortable(): void;
  /** Importer un dossier Markdown / coffre Obsidian dans l'espace. */
  importMarkdown(): void;
  exportLlm(): void;
  connectAssistant(): void;
  activity(): void;
  /** Santé de la base (`gaps` : sujets à documenter). */
  health(focus: 'all' | 'gaps'): void;
  /** Fenêtre de capture rapide (comme le raccourci global). */
  quickCapture(): void;
  /** Sélectionne la boîte de réception (captures à ranger). */
  openInbox(): void;
  settings(): void;
  preferences(): void;
  help(): void;
  close(): void;
}

export interface WorkspaceActionState {
  view: ViewMode;
  exporting: boolean;
  hidden: ReadonlySet<string>;
  solo: string | null;
  /** Un nœud est masqué ou une branche est seule affichée. */
  masking: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Terminal intégré affiché. */
  terminalOpen: boolean;
  /** Vues graphe enregistrées : une action « Vue : … » chacune. */
  savedViews: readonly { id: string; name: string }[];
}

/**
 * Actions portant sur un nœud : le nœud sélectionné (palette, raccourcis) ou
 * celui du menu contextuel. Sans nœud, elles sont inactives.
 */
export function nodeActions(
  node: NodeSummary | null,
  state: WorkspaceActionState,
  commands: WorkspaceCommands,
): AppAction[] {
  const on = node !== null;
  const id = node?.id ?? '';
  return [
    {
      id: 'node.newChild',
      label: 'Nouveau sous-nœud',
      group: 'Nœud',
      shortcuts: [{ key: 'n', ctrl: true }],
      enabled: true,
      // Sans nœud sélectionné, Ctrl+N crée une racine (comme avant).
      run: () => commands.newNode(node?.id ?? null),
    },
    {
      id: 'node.rename',
      label: 'Renommer',
      group: 'Nœud',
      enabled: on,
      run: () => commands.rename(id),
    },
    {
      id: 'node.toggleHidden',
      label: state.hidden.has(id)
        ? 'Afficher dans le graphe'
        : 'Masquer dans le graphe',
      group: 'Nœud',
      keywords: 'oeil cacher visibilite',
      enabled: on,
      run: () => commands.toggleHidden(id),
    },
    {
      id: 'node.solo',
      label:
        state.solo === id
          ? 'Quitter « cette branche seule »'
          : 'Afficher cette branche seule',
      group: 'Nœud',
      keywords: 'solo oeil isoler',
      enabled: on,
      run: () => commands.toggleSolo(id),
    },
    {
      id: 'node.center',
      label: 'Centrer dans le graphe',
      group: 'Nœud',
      enabled: on,
      run: () => commands.center(id),
    },
    {
      id: 'node.pathTo',
      label: 'Chemin vers…',
      group: 'Nœud',
      keywords: 'relation lien plus court trajet',
      enabled: on,
      run: () => commands.pathFrom(id),
    },
    {
      id: 'node.impact',
      label: 'Impact d’un changement',
      group: 'Nœud',
      keywords: 'dépendance dépend touché revoir',
      enabled: on,
      run: () => commands.impact(id),
    },
    {
      id: 'node.validate',
      label: 'Valider (ajouté par l’IA)',
      group: 'Nœud',
      keywords: 'assistant ia relecture',
      enabled: Boolean(node?.assistantPending),
      run: () => commands.validate(id),
    },
    {
      id: 'node.addDocument',
      label: 'Ajouter un document',
      group: 'Nœud',
      enabled: on,
      run: () => commands.addDocument(id),
    },
    {
      id: 'node.move',
      label: 'Déplacer vers…',
      group: 'Nœud',
      enabled: on,
      run: () => node && commands.move(node),
    },
    {
      id: 'node.duplicate',
      label: 'Dupliquer…',
      group: 'Nœud',
      keywords: 'copier',
      enabled: on,
      run: () => node && commands.duplicate(node),
    },
    {
      id: 'node.delete',
      label: 'Supprimer…',
      group: 'Nœud',
      enabled: on,
      run: () => commands.delete(id),
    },
  ];
}

/** Actions de l'espace et de l'application, indépendantes d'un nœud. */
export function workspaceActions(
  state: WorkspaceActionState,
  commands: WorkspaceCommands,
): AppAction[] {
  return [
    {
      id: 'nav.back',
      label: 'Nœud précédent',
      group: 'Vue',
      shortcuts: [{ key: 'ArrowLeft', alt: true }],
      keywords: 'historique retour arriere',
      enabled: state.canGoBack,
      run: () => commands.navigate(-1),
    },
    {
      id: 'nav.forward',
      label: 'Nœud suivant',
      group: 'Vue',
      shortcuts: [{ key: 'ArrowRight', alt: true }],
      keywords: 'historique avancer',
      enabled: state.canGoForward,
      run: () => commands.navigate(1),
    },
    {
      id: 'node.newRoot',
      label: 'Nouveau nœud racine',
      group: 'Nœud',
      shortcuts: [{ key: 'n', ctrl: true, shift: true }],
      keywords: 'creer ajouter',
      enabled: true,
      run: () => commands.newNode(null),
    },
    {
      id: 'view.toggle',
      label:
        state.view === 'graph'
          ? 'Basculer vers les documents'
          : 'Basculer vers le graphe',
      group: 'Vue',
      keywords: 'graphe documents vue',
      enabled: true,
      run: () =>
        commands.setView(state.view === 'graph' ? 'documents' : 'graph'),
    },
    ...state.savedViews.map((saved): AppAction => ({
      id: `view.apply:${saved.id}`,
      label: `Vue : ${saved.name}`,
      group: 'Vue',
      keywords: 'graphe enregistree appliquer',
      enabled: true,
      run: () => commands.applyView(saved.id),
    })),
    {
      id: 'view.showAll',
      label: 'Tout réafficher dans le graphe',
      group: 'Vue',
      keywords: 'oeil masques solo',
      enabled: state.masking,
      run: commands.showAll,
    },
    {
      id: 'view.search',
      label: 'Rechercher dans les documents',
      group: 'Vue',
      shortcuts: [
        { key: 'f', ctrl: true },
        { key: 'k', ctrl: true },
      ],
      enabled: true,
      run: commands.focusSearch,
    },
    {
      id: 'view.terminal',
      label: state.terminalOpen ? 'Masquer le terminal' : 'Ouvrir le terminal',
      group: 'Vue',
      // Ctrl+` : touche morte sur un clavier AZERTY, d'où Ctrl+J d'abord.
      shortcuts: [
        { key: 'j', ctrl: true },
        { key: '`', ctrl: true },
      ],
      keywords: 'console shell powershell commande invite',
      enabled: true,
      run: commands.toggleTerminal,
    },
    {
      id: 'app.palette',
      label: 'Palette de commandes',
      group: 'Application',
      shortcuts: [{ key: 'p', ctrl: true }],
      enabled: true,
      run: () => commands.openPalette(false),
    },
    {
      id: 'app.paletteActions',
      label: 'Palette : actions seules',
      group: 'Application',
      shortcuts: [{ key: 'p', ctrl: true, shift: true }],
      enabled: true,
      run: () => commands.openPalette(true),
    },
    {
      id: 'workspace.save',
      label: 'Enregistrer maintenant',
      group: 'Espace',
      shortcuts: [{ key: 's', ctrl: true }],
      enabled: true,
      run: commands.save,
    },
    {
      id: 'workspace.tags',
      label: 'Tags…',
      group: 'Espace',
      keywords: 'gerer etiquettes',
      enabled: true,
      run: commands.tags,
    },
    {
      id: 'workspace.templates',
      label: 'Modèles de documents…',
      group: 'Espace',
      keywords: 'gabarit procedure composant donnee adr decision',
      enabled: true,
      run: commands.templates,
    },
    {
      id: 'workspace.relationTypes',
      label: 'Types de relations…',
      group: 'Espace',
      enabled: true,
      run: commands.relationTypes,
    },
    {
      id: 'workspace.export',
      label: 'Export portable (dossier + manifest)…',
      group: 'Espace',
      keywords: 'exporter sauvegarde',
      enabled: !state.exporting,
      run: commands.exportPortable,
    },
    {
      id: 'workspace.importMarkdown',
      label: 'Importer un dossier Markdown / Obsidian…',
      group: 'Espace',
      keywords: 'coffre vault notes md',
      enabled: true,
      run: commands.importMarkdown,
    },
    {
      id: 'workspace.exportLlm',
      label: 'Export pour LLM (TOON, fragments)…',
      group: 'Espace',
      keywords: 'exporter ia',
      enabled: !state.exporting,
      run: commands.exportLlm,
    },
    {
      id: 'workspace.mcp',
      label: 'Connecter un assistant IA (MCP)…',
      group: 'Espace',
      keywords: 'claude serveur',
      enabled: true,
      run: commands.connectAssistant,
    },
    {
      id: 'workspace.activity',
      label: 'Activité IA…',
      group: 'Espace',
      keywords: 'assistant journal annuler',
      enabled: true,
      run: commands.activity,
    },
    {
      id: 'workspace.health',
      label: 'Santé de la base…',
      group: 'Espace',
      keywords: 'qualite verifier resume orphelin doublon casse',
      enabled: true,
      run: () => commands.health('all'),
    },
    {
      id: 'workspace.gaps',
      label: 'Sujets à documenter…',
      group: 'Espace',
      keywords: 'lacunes recherches sans resultat ia',
      enabled: true,
      run: () => commands.health('gaps'),
    },
    {
      id: 'workspace.quickCapture',
      label: 'Capture rapide…',
      group: 'Espace',
      keywords: 'noter idee boite reception inbox',
      enabled: true,
      run: commands.quickCapture,
    },
    {
      id: 'workspace.inbox',
      label: 'Boîte de réception',
      group: 'Espace',
      keywords: 'captures ranger inbox',
      enabled: true,
      run: commands.openInbox,
    },
    {
      id: 'workspace.settings',
      label: 'Paramètres de l’espace…',
      group: 'Espace',
      enabled: true,
      run: commands.settings,
    },
    {
      id: 'workspace.close',
      label: 'Fermer l’espace',
      group: 'Espace',
      enabled: true,
      run: commands.close,
    },
    {
      id: 'app.preferences',
      label: 'Préférences…',
      group: 'Application',
      keywords: 'theme couleur densite apparence',
      // Ctrl+, est géré par l'application (aussi hors d'un espace).
      hint: 'Ctrl + ,',
      enabled: true,
      run: commands.preferences,
    },
    {
      id: 'app.help',
      label: 'Aide',
      group: 'Application',
      shortcuts: [{ key: 'F1' }],
      enabled: true,
      run: commands.help,
    },
  ];
}
