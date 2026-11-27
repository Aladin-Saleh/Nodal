/**
 * Contrat IPC typé, partagé par main, preload et renderer.
 *
 * Ce module ne doit contenir aucune dépendance d'exécution (pas de zod) pour
 * rester léger dans le bundle preload. Les schémas de validation sont dans
 * `ipc-schemas.ts`, utilisés uniquement côté main.
 */
import type { McpClient } from './mcp-clients';
import type { Confidence } from './evidence';
import type { Lesson } from './lessons';
import type { TerminalEvent, TerminalSession, TerminalShell } from './terminal';
import type { ContentType, NodeType } from './domain';
import type { SerializedError } from './errors';
import type { AppPreferences, PreferencesUpdate } from './preferences';
import type {
  AssistantChange,
  AttachmentInfo,
  BulkDeletionImpact,
  ChildrenStrategy,
  DocumentInfo,
  EdgeInfo,
  ExportResult,
  IntegrityReport,
  LlmExportOptions,
  LlmExportResult,
  GraphData,
  MergePreview,
  VaultExportResult,
  WorkspaceComparison,
  NodeDeletionImpact,
  NodeDetail,
  NodePosition,
  NodeRelation,
  NodeSummary,
  RecentWorkspace,
  RelationTypeInfo,
  SearchHit,
  TagInfo,
  WorkspaceSettings,
  GraphViewSettings,
  GraphCamera,
  GraphViewInfo,
  Backlink,
  LinkSuggestion,
  HealthReport,
} from './model';
import type {
  CodeFileContent,
  CodeRootInfo,
  NodeAnchors,
  StaleNode,
} from './code-anchors';
import type {
  CaptureInput,
  CaptureResult,
  CaptureTarget,
} from './quick-capture';
import type { NodeLinkTarget } from './node-links';
import type { DocumentTemplate, TemplateList } from './templates';
import type {
  MarkdownImportPreview,
  MarkdownImportReport,
} from './markdown-import';

export interface AppInfo {
  appName: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  sqliteVersion: string;
  /** Script du serveur MCP (exécuté par Node.js, hors de l'archive asar). */
  mcpServerPath: string;
  /** Node qui le lance : celui livré avec Nodal, sinon `node`. */
  nodePath: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string | null;
  filePath: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInput {
  name: string;
}
export interface UpdateWorkspaceInput {
  name?: string;
  description?: string | null;
}
export interface IdInput {
  id: string;
}
export interface CreateGraphViewInput {
  name: string;
  settings: GraphViewSettings;
  camera: GraphCamera | null;
}

/** Champs absents : inchangés. */
export interface UpdateGraphViewInput {
  id: string;
  name?: string;
  settings?: GraphViewSettings;
  camera?: GraphCamera | null;
}

export interface CreateNodeInput {
  parentId: string | null;
  title: string;
  nodeType: NodeType;
  /** Modèle de document à ajouter au nœud créé ; absent ou `null` : aucun. */
  templateId?: string | null;
}
export interface UpdateNodeInput {
  id: string;
  title?: string;
  nodeType?: NodeType;
  summary?: string | null;
  color?: string | null;
}
export interface MoveNodeInput {
  id: string;
  parentId: string | null;
  /** Position parmi les nouveaux frères ; à la fin si absente. */
  index?: number;
}
export interface MoveManyNodesInput {
  ids: string[];
  parentId: string | null;
}
export interface SetNodesTypeInput {
  ids: string[];
  nodeType: NodeType;
}
export interface IdsInput {
  ids: string[];
}
export interface DeleteManyNodesInput {
  ids: string[];
  childrenStrategy: ChildrenStrategy;
}
export interface DuplicateNodeInput {
  id: string;
  includeChildren: boolean;
}
export interface DeleteNodeInput {
  id: string;
  childrenStrategy: ChildrenStrategy;
}
export interface SetNodeTagsInput {
  id: string;
  tagIds: string[];
}
export interface CreateDocumentInput {
  nodeId: string;
  title: string;
  contentType: ContentType;
  language?: string | null;
  /** Document Markdown pré-rempli avec ce modèle. */
  templateId?: string;
}
export interface UpdateDocumentInput {
  id: string;
  title?: string;
  body?: string;
  language?: string | null;
}
export interface ReorderDocumentsInput {
  nodeId: string;
  orderedIds: string[];
}
export interface CreateTagInput {
  name: string;
  color?: string | null;
}
export interface UpdateTagInput {
  id: string;
  name?: string;
  color?: string | null;
}
export interface AddAttachmentsInput {
  nodeId: string;
}
export interface CreateRelationTypeInput {
  name: string;
  color?: string | null;
}
export interface UpdateRelationTypeInput {
  id: string;
  name?: string;
  color?: string | null;
}
export interface CreateEdgeInput {
  sourceId: string;
  targetId: string;
  relationTypeId: string;
  label?: string | null;
  description?: string | null;
  confidence?: Confidence | null;
}
export interface UpdateEdgeInput {
  id: string;
  relationTypeId?: string;
  label?: string | null;
  description?: string | null;
  confidence?: Confidence | null;
}
/** Résultat d'un import : nouvel espace ouvert, ou rapport de validation. */
export type ImportResult =
  | {
      kind: 'imported';
      workspace: WorkspaceInfo;
      nodeCount: number;
      documentCount: number;
      attachmentCount: number;
    }
  | { kind: 'invalid'; errors: string[] };

export interface SearchInput {
  query: string;
}
export interface SavePositionsInput {
  positions: NodePosition[];
}

/** Arguments et résultat de chaque canal (renderer → main). */
export interface IpcContract {
  'app:getInfo': { args: []; result: AppInfo };
  /** Le renderer signale des modifications pas encore enregistrées. */
  'app:setUnsavedChanges': { args: [boolean]; result: null };
  /** Préférences de l'application (profil utilisateur). */
  'preferences:get': { args: []; result: AppPreferences };
  'preferences:update': { args: [PreferencesUpdate]; result: AppPreferences };

  /** Fenêtre de capture : espace qui recevra la capture, ou `null`. */
  'capture:getTarget': { args: []; result: CaptureTarget | null };
  /** Fenêtre de capture : range la capture dans la boîte de réception. */
  'capture:submit': { args: [CaptureInput]; result: CaptureResult };
  /** Ouvre la fenêtre de capture (palette, sans le raccourci global). */
  'capture:open': { args: []; result: null };
  /** Boîte de réception de l'espace ouvert, ou `null` si elle n'existe pas. */
  'capture:getInbox': { args: []; result: string | null };
  /** Le raccourci global est-il actif (sinon pris par une autre application) ? */
  'capture:shortcutStatus': { args: []; result: { registered: boolean } };

  /** `null` si l'utilisateur annule la boîte de dialogue. */
  'workspace:create': {
    args: [CreateWorkspaceInput];
    result: WorkspaceInfo | null;
  };
  /** `null` si l'utilisateur annule la boîte de dialogue. */
  'workspace:open': { args: []; result: WorkspaceInfo | null };
  'workspace:openRecent': { args: [IdInput]; result: WorkspaceInfo };
  'workspace:listRecent': { args: []; result: RecentWorkspace[] };
  'workspace:removeRecent': { args: [IdInput]; result: null };
  'workspace:close': { args: []; result: null };
  'workspace:getCurrent': { args: []; result: WorkspaceInfo | null };
  'workspace:update': { args: [UpdateWorkspaceInput]; result: WorkspaceInfo };
  /**
   * Après confirmation native, ferme l'espace courant et place son fichier
   * dans la corbeille ; `false` si l'utilisateur annule.
   */
  'workspace:delete': { args: []; result: boolean };
  'workspace:getSettings': { args: []; result: WorkspaceSettings };
  'workspace:updateSettings': {
    args: [WorkspaceSettings];
    result: WorkspaceSettings;
  };
  /** Réglages d'affichage du graphe enregistrés ; `null` s'il n'y en a pas. */
  'view:getGraph': { args: []; result: GraphViewSettings | null };
  'view:saveGraph': { args: [GraphViewSettings]; result: null };
  /** Vues graphe enregistrées, par ordre de création. */
  'graphView:list': { args: []; result: GraphViewInfo[] };
  'graphView:create': { args: [CreateGraphViewInput]; result: GraphViewInfo };
  'graphView:update': { args: [UpdateGraphViewInput]; result: GraphViewInfo };
  'graphView:delete': { args: [IdInput]; result: null };
  /** Vue appliquée à l'ouverture ; `null` : reprendre la dernière session. */
  'graphView:setDefault': { args: [{ id: string | null }]; result: null };

  'node:list': { args: []; result: NodeSummary[] };
  /** Documents qui mentionnent ce nœud par un lien [[...]]. */
  'node:backlinks': { args: [IdInput]; result: Backlink[] };
  /** Rapport « Santé de la base » et sujets à documenter. */
  'health:report': { args: []; result: HealthReport };
  /** « Pas un doublon » : la paire n'est plus signalée. */
  'duplicate:ignore': {
    args: [{ firstId: string; secondId: string }];
    result: null;
  };
  /** Sujet à documenter traité (`done`) ou écarté (`ignored`). */
  'gap:setStatus': {
    args: [{ key: string; status: 'done' | 'ignored' }];
    result: null;
  };
  /** « Relier ? » : titres d'autres nœuds cités par les documents du nœud. */
  'suggestion:listForNode': { args: [IdInput]; result: LinkSuggestion[] };
  'suggestion:accept': {
    args: [{ sourceId: string; targetId: string; mode: 'relation' | 'link' }];
    result: null;
  };
  'suggestion:ignore': {
    args: [{ sourceId: string; targetId: string }];
    result: null;
  };
  /** Dossiers de code de l'espace (chemins locaux). */
  'code:getRoots': { args: []; result: CodeRootInfo[] };
  /** Choix d'un dossier par le main ; `null` si annulé. */
  'code:addRoot': { args: []; result: CodeRootInfo[] | null };
  'code:removeRoot': { args: [{ path: string }]; result: CodeRootInfo[] };
  /** Types de terminal disponibles sur ce poste, le premier par défaut. */
  'terminal:listShells': { args: []; result: TerminalShell[] };
  /** Terminal intégré : nouveau shell (dossier de code de l'espace). */
  'terminal:create': {
    args: [{ cols: number; rows: number; shell?: string; folder?: string }];
    result: TerminalSession;
  };
  /** Tape `cd` vers un dossier de code de l'espace ; renvoie ce dossier. */
  'terminal:changeDirectory': {
    args: [{ id: string; folder: string }];
    result: string;
  };
  'terminal:write': { args: [{ id: string; data: string }]; result: null };
  'terminal:resize': {
    args: [{ id: string; cols: number; rows: number }];
    result: null;
  };
  'terminal:close': { args: [{ id: string }]; result: null };
  /**
   * Connecte un assistant : configuration MCP, skills et contexte automatique,
   * dans un dossier de projet choisi par le main ; `null` si annulé.
   */
  'assistant:connect': {
    args: [{ client: McpClient; allowWrites: boolean }];
    result: { files: string[]; note: string | null } | null;
  };
  /** Motifs ancrés au nœud, fichiers trouvés, obsolescence éventuelle. */
  'anchor:listForNode': { args: [IdInput]; result: NodeAnchors };
  /** Remplace les motifs ancrés ; renvoie la liste normalisée. */
  'anchor:set': {
    args: [{ nodeId: string; patterns: string[] }];
    result: string[];
  };
  /** Choix de fichiers par le main (dans un dossier de code) ; `null` si annulé. */
  'anchor:pickFiles': { args: [IdInput]; result: string[] | null };
  /** Lien `nodal://` en attente, résolu (espace à ouvrir, nœud) ; `null` sinon. */
  'link:takePending': { args: []; result: NodeLinkTarget | null };
  /** Lien `nodal://` cliqué dans l'application (terminal) : traité comme un lien reçu. */
  'link:open': { args: [{ url: string }]; result: null };
  /** Contenu d'un fichier ancré au nœud (chemin affiché), en lecture seule. */
  'anchor:readFile': {
    args: [{ nodeId: string; path: string }];
    result: CodeFileContent;
  };
  /** « Marquer comme à jour ». */
  'anchor:markReviewed': { args: [IdInput]; result: null };
  /** Nœuds dont un fichier ancré a changé depuis leur dernière mise à jour. */
  'anchor:staleNodes': { args: []; result: StaleNode[] };
  'node:get': { args: [IdInput]; result: NodeDetail };
  'node:create': { args: [CreateNodeInput]; result: NodeSummary };
  'node:update': { args: [UpdateNodeInput]; result: NodeSummary };
  'node:move': { args: [MoveNodeInput]; result: null };
  /** Crée ou met à jour le schéma Mermaid de la branche. */
  'node:writeSchema': {
    args: [IdInput];
    result: { documentId: string; omittedNodes: number; omittedEdges: number };
  };
  'node:mergePreview': {
    args: [{ firstId: string; secondId: string }];
    result: MergePreview;
  };
  /** Fusion, après sauvegarde automatique (`backupPath`). */
  'node:merge': {
    args: [{ keepId: string; dropId: string }];
    result: { documents: number; links: number; backupPath: string };
  };
  'node:duplicate': { args: [DuplicateNodeInput]; result: NodeSummary };
  'node:getDeletionImpact': { args: [IdInput]; result: NodeDeletionImpact };
  'node:delete': { args: [DeleteNodeInput]; result: null };
  'node:setTags': { args: [SetNodeTagsInput]; result: TagInfo[] };
  'node:moveMany': { args: [MoveManyNodesInput]; result: null };
  'node:setTypeMany': { args: [SetNodesTypeInput]; result: null };
  'node:getDeletionImpactMany': {
    args: [IdsInput];
    result: BulkDeletionImpact;
  };
  'node:deleteMany': { args: [DeleteManyNodesInput]; result: null };

  'document:get': { args: [IdInput]; result: DocumentInfo };
  'document:create': { args: [CreateDocumentInput]; result: DocumentInfo };

  /** Modèles de documents de l'espace (par défaut tant qu'ils n'ont pas changé). */
  'template:list': { args: []; result: TemplateList };
  'template:save': {
    args: [{ templates: DocumentTemplate[] }];
    result: TemplateList;
  };
  /** Revient aux modèles par défaut. */
  'template:reset': { args: []; result: TemplateList };
  'document:update': { args: [UpdateDocumentInput]; result: DocumentInfo };
  'document:delete': { args: [IdInput]; result: null };
  'document:reorder': { args: [ReorderDocumentsInput]; result: null };

  'tag:list': { args: []; result: TagInfo[] };
  'tag:create': { args: [CreateTagInput]; result: TagInfo };
  'tag:update': { args: [UpdateTagInput]; result: TagInfo };
  'tag:delete': { args: [IdInput]; result: null };

  /** Ouvre une boîte de dialogue de sélection ; liste vide si annulée. */
  'attachment:add': { args: [AddAttachmentsInput]; result: AttachmentInfo[] };
  /** Enregistre une copie sur le disque ; `false` si annulé. */
  'attachment:save': { args: [IdInput]; result: boolean };
  'attachment:delete': { args: [IdInput]; result: null };

  'relationType:list': { args: []; result: RelationTypeInfo[] };
  'relationType:create': {
    args: [CreateRelationTypeInput];
    result: RelationTypeInfo;
  };
  'relationType:update': {
    args: [UpdateRelationTypeInput];
    result: RelationTypeInfo;
  };
  /** Refusé si des relations utilisent encore ce type. */
  'relationType:delete': { args: [IdInput]; result: null };

  'edge:listForNode': { args: [IdInput]; result: NodeRelation[] };
  'edge:create': { args: [CreateEdgeInput]; result: EdgeInfo };
  'edge:update': { args: [UpdateEdgeInput]; result: EdgeInfo };
  'edge:delete': { args: [IdInput]; result: null };

  'graph:get': { args: []; result: GraphData };
  'graph:savePositions': { args: [SavePositionsInput]; result: null };

  'search:query': { args: [SearchInput]; result: SearchHit[] };
  /** Choix du dossier par le main ; `null` si annulé. */
  'workspace:export': { args: []; result: ExportResult | null };
  /** Export vers un coffre Obsidian, dans un nouveau dossier. */
  'workspace:exportVault': { args: []; result: VaultExportResult | null };
  /** Ce qui a changé depuis une sauvegarde choisie ; `null` si annulé. */
  'workspace:compare': {
    args: [];
    result: { file: string; comparison: WorkspaceComparison } | null;
  };
  /** Export LLM (TOON, JSON, fragments) ; `null` si annulé. */
  'workspace:exportLlm': {
    args: [LlmExportOptions];
    result: LlmExportResult | null;
  };
  /** Valide un dossier d'export puis crée un nouvel espace ; `null` si annulé. */
  'workspace:import': { args: []; result: ImportResult | null };
  /**
   * Choisit un dossier Markdown / coffre Obsidian et le lit ; aperçu de
   * l'import, ou `null` si annulé. Rien n'est écrit.
   */
  'markdownImport:pick': { args: []; result: MarkdownImportPreview | null };
  /** Sauvegarde l'espace puis importe le dossier de l'aperçu `token`. */
  'markdownImport:run': {
    args: [{ token: string }];
    result: MarkdownImportReport;
  };
  /** Oublie le dossier lu (aperçu fermé sans importer). */
  'markdownImport:cancel': { args: []; result: null };
  /** Copie de sauvegarde du fichier courant ; chemin créé, ou `null` si annulé. */
  'workspace:backup': { args: []; result: string | null };
  'workspace:checkIntegrity': { args: []; result: IntegrityReport };

  /** Journal des modifications d'un assistant IA (MCP), plus récentes d'abord. */
  'assistant:listChanges': { args: []; result: AssistantChange[] };
  'assistant:undo': { args: [IdInput]; result: null };
  /** Mémoire de travail : leçons notées par un assistant. */
  'lesson:list': { args: []; result: Lesson[] };
  'lesson:delete': { args: [IdInput]; result: null };
  /** Valide des nœuds ajoutés par l'IA ; renvoie combien l'étaient pas encore. */
  'assistant:validateNodes': {
    args: [{ ids: string[] }];
    result: { validated: number };
  };
}

export type IpcChannel = keyof IpcContract;
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args'];
export type IpcResultData<C extends IpcChannel> = IpcContract[C]['result'];

/** Liste blanche des canaux, vérifiée par le preload. */
export const IPC_CHANNELS = [
  'app:getInfo',
  'app:setUnsavedChanges',
  'preferences:get',
  'preferences:update',
  'capture:getTarget',
  'capture:submit',
  'capture:open',
  'capture:getInbox',
  'capture:shortcutStatus',
  'workspace:create',
  'workspace:open',
  'workspace:openRecent',
  'workspace:listRecent',
  'workspace:removeRecent',
  'workspace:close',
  'workspace:getCurrent',
  'workspace:update',
  'workspace:delete',
  'workspace:getSettings',
  'workspace:updateSettings',
  'view:getGraph',
  'view:saveGraph',
  'graphView:list',
  'graphView:create',
  'graphView:update',
  'graphView:delete',
  'graphView:setDefault',
  'node:list',
  'node:backlinks',
  'suggestion:listForNode',
  'health:report',
  'duplicate:ignore',
  'gap:setStatus',
  'suggestion:accept',
  'suggestion:ignore',
  'code:getRoots',
  'code:addRoot',
  'code:removeRoot',
  'assistant:connect',
  'terminal:listShells',
  'terminal:create',
  'terminal:changeDirectory',
  'terminal:write',
  'terminal:resize',
  'terminal:close',
  'anchor:listForNode',
  'anchor:set',
  'anchor:pickFiles',
  'anchor:readFile',
  'link:takePending',
  'link:open',
  'anchor:markReviewed',
  'anchor:staleNodes',
  'node:get',
  'node:create',
  'node:update',
  'node:move',
  'node:writeSchema',
  'node:mergePreview',
  'node:merge',
  'node:duplicate',
  'node:getDeletionImpact',
  'node:delete',
  'node:setTags',
  'node:moveMany',
  'node:setTypeMany',
  'node:getDeletionImpactMany',
  'node:deleteMany',
  'document:get',
  'document:create',
  'template:list',
  'template:save',
  'template:reset',
  'document:update',
  'document:delete',
  'document:reorder',
  'tag:list',
  'tag:create',
  'tag:update',
  'tag:delete',
  'attachment:add',
  'attachment:save',
  'attachment:delete',
  'relationType:list',
  'relationType:create',
  'relationType:update',
  'relationType:delete',
  'edge:listForNode',
  'edge:create',
  'edge:update',
  'edge:delete',
  'graph:get',
  'graph:savePositions',
  'search:query',
  'workspace:export',
  'workspace:exportVault',
  'workspace:compare',
  'workspace:exportLlm',
  'workspace:import',
  'workspace:backup',
  'markdownImport:pick',
  'markdownImport:run',
  'markdownImport:cancel',
  'workspace:checkIntegrity',
  'assistant:listChanges',
  'assistant:undo',
  'lesson:list',
  'lesson:delete',
  'assistant:validateNodes',
] as const satisfies readonly IpcChannel[];

/** Événements main → renderer. */
export const IPC_EVENTS = {
  /** Le main demande d'enregistrer immédiatement (fermeture de la fenêtre). */
  flushRequest: 'app:flushRequest',
  /** Le fichier de l'espace a été modifié par un autre processus (serveur MCP). */
  externalChange: 'workspace:externalChange',
  /** Préférences modifiées hors du renderer (raccourci de zoom). */
  preferencesChanged: 'preferences:changed',
  /** Sortie ou fin d'un terminal intégré. */
  terminal: 'terminal:event',
  /** Lien `nodal://` reçu : le renderer le demande par link:takePending. */
  nodeLink: 'link:received',
} as const;

/** Enveloppe de réponse : le main ne laisse jamais remonter d'exception brute. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SerializedError };

/** API exposée par le preload sur `window.nodal`. */
export interface NodalApi {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcArgs<C>
  ): Promise<IpcResult<IpcResultData<C>>>;
  /** Abonnement à la demande d'enregistrement ; retourne le désabonnement. */
  onFlushRequest(listener: () => void): () => void;
  /** Abonnement aux modifications externes de l'espace ; retourne le désabonnement. */
  onExternalChange(listener: () => void): () => void;
  /** Abonnement aux liens `nodal://` reçus ; retourne le désabonnement. */
  onNodeLink(listener: () => void): () => void;
  /** Abonnement aux sorties des terminaux intégrés. */
  onTerminalEvent(listener: (event: TerminalEvent) => void): () => void;
  /** Abonnement aux changements de préférences venus du main. */
  onPreferencesChanged(
    listener: (preferences: AppPreferences) => void,
  ): () => void;
}
