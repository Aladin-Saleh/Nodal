/**
 * Contrat IPC typé, partagé par main, preload et renderer.
 *
 * Ce module ne doit contenir aucune dépendance d'exécution (pas de zod) pour
 * rester léger dans le bundle preload. Les schémas de validation sont dans
 * `ipc-schemas.ts`, utilisés uniquement côté main.
 */
import type { ContentType, NodeType } from './domain';
import type { SerializedError } from './errors';
import type {
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
} from './model';

export interface AppInfo {
  appName: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  sqliteVersion: string;
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
export interface CreateNodeInput {
  parentId: string | null;
  title: string;
  nodeType: NodeType;
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
}
export interface UpdateEdgeInput {
  id: string;
  relationTypeId?: string;
  label?: string | null;
  description?: string | null;
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

  'node:list': { args: []; result: NodeSummary[] };
  'node:get': { args: [IdInput]; result: NodeDetail };
  'node:create': { args: [CreateNodeInput]; result: NodeSummary };
  'node:update': { args: [UpdateNodeInput]; result: NodeSummary };
  'node:move': { args: [MoveNodeInput]; result: null };
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
  /** Export LLM (TOON, JSON, fragments) ; `null` si annulé. */
  'workspace:exportLlm': {
    args: [LlmExportOptions];
    result: LlmExportResult | null;
  };
  /** Valide un dossier d'export puis crée un nouvel espace ; `null` si annulé. */
  'workspace:import': { args: []; result: ImportResult | null };
  /** Copie de sauvegarde du fichier courant ; chemin créé, ou `null` si annulé. */
  'workspace:backup': { args: []; result: string | null };
  'workspace:checkIntegrity': { args: []; result: IntegrityReport };
}

export type IpcChannel = keyof IpcContract;
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args'];
export type IpcResultData<C extends IpcChannel> = IpcContract[C]['result'];

/** Liste blanche des canaux, vérifiée par le preload. */
export const IPC_CHANNELS = [
  'app:getInfo',
  'app:setUnsavedChanges',
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
  'node:list',
  'node:get',
  'node:create',
  'node:update',
  'node:move',
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
  'workspace:exportLlm',
  'workspace:import',
  'workspace:backup',
  'workspace:checkIntegrity',
] as const satisfies readonly IpcChannel[];

/** Événements main → renderer. */
export const IPC_EVENTS = {
  /** Le main demande d'enregistrer immédiatement (fermeture de la fenêtre). */
  flushRequest: 'app:flushRequest',
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
}
