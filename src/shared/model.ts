/**
 * Objets du modèle documentaire échangés entre main et renderer (§5.1).
 * Ce sont des vues : le contenu binaire des pièces jointes n'y figure jamais.
 */
import type { AssistantAction, ContentType, NodeType } from './domain';

export interface NodeSummary {
  id: string;
  parentId: string | null;
  title: string;
  nodeType: NodeType;
  color: string | null;
  sortOrder: number;
  /** Ajouté par un assistant IA et pas encore validé par l'utilisateur. */
  assistantPending?: boolean;
}

export interface NodePathItem {
  id: string;
  title: string;
}

export interface NodeDetail extends NodeSummary {
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  /** Ancêtres, de la racine au parent direct. */
  path: NodePathItem[];
  tags: TagInfo[];
  documents: DocumentSummary[];
  attachments: AttachmentInfo[];
  childCount: number;
  edgeCount: number;
  /** `null` : nœud créé dans l'application (ou avant le journal). */
  createdByAssistant: AssistantOrigin | null;
}

export interface DocumentSummary {
  id: string;
  nodeId: string;
  title: string;
  contentType: ContentType;
  language: string | null;
  sortOrder: number;
  updatedAt: string;
}

export interface DocumentInfo extends DocumentSummary {
  body: string;
  createdAt: string;
}

export interface TagInfo {
  id: string;
  name: string;
  color: string | null;
  /** Nombre de nœuds portant ce tag. */
  usageCount: number;
}

export interface AttachmentInfo {
  id: string;
  nodeId: string | null;
  documentId: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
}

export interface DeletionCounts {
  documentCount: number;
  attachmentCount: number;
  edgeCount: number;
}

/** Ce que supprimerait la suppression d'un nœud, pour une confirmation éclairée. */
export interface NodeDeletionImpact {
  childCount: number;
  descendantCount: number;
  /** Données du nœud seul (stratégie `reparent`). */
  node: DeletionCounts;
  /** Données du nœud et de tout son sous-arbre (stratégie `delete`). */
  subtree: DeletionCounts;
}

/** Impact cumulé d'une suppression groupée (enfants hors sélection). */
export interface BulkDeletionImpact extends NodeDeletionImpact {
  nodeCount: number;
}

/**
 * Sort des enfants d'un nœud supprimé (§5.4) :
 * - `reparent` : les enfants remontent au niveau du nœud supprimé ;
 * - `delete` : tout le sous-arbre est supprimé.
 */
export type ChildrenStrategy = 'reparent' | 'delete';

export interface WorkspaceSettings {
  attachmentMaxSizeBytes: number;
}

/**
 * Réglages d'affichage du graphe d'un espace, restaurés à sa réouverture.
 * Affichage seulement : sans effet sur la recherche, l'export ou le serveur
 * MCP. Les identifiants qui n'existent plus sont ignorés à la restauration.
 */
export interface GraphViewSettings {
  /** `null` : choix automatique selon la taille de l'espace. */
  scope: 'all' | 'neighborhood' | null;
  depth: number;
  nodeTypes: NodeType[];
  tagIds: string[];
  hiddenRelationTypeIds: string[];
  showHierarchy: boolean;
  /** Nœuds repliés. */
  collapsed: string[];
  /** Nœuds masqués avec l'œil (et donc leurs descendants). */
  hidden: string[];
  /** Branche affichée seule (Alt+clic sur l'œil). */
  solo: string | null;
  /** Filtre « Ajouté par l'IA, non validé ». */
  assistantPendingOnly: boolean;
}

export interface RecentWorkspace {
  id: string;
  name: string;
  filePath: string;
  lastOpenedAt: string;
  exists: boolean;
}

/** Type de relation propre à l'espace (§5.3, §13). */
export interface RelationTypeInfo {
  id: string;
  name: string;
  color: string | null;
  isBuiltin: boolean;
  /** Nombre de relations de ce type. */
  usageCount: number;
}

/** Relation transversale entre deux nœuds, indépendante de la hiérarchie. */
export interface EdgeInfo {
  id: string;
  sourceId: string;
  targetId: string;
  relationTypeId: string;
  /** Libellé propre à la relation ; sinon le nom du type est affiché. */
  label: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Relation vue depuis un nœud (panneau de propriétés, §7). */
/** Élément créé par un assistant IA via MCP (d'après le journal). */
export interface AssistantOrigin {
  client: string | null;
  createdAt: string;
}

export interface NodeRelation extends EdgeInfo {
  direction: 'outgoing' | 'incoming';
  otherNodeId: string;
  otherNodeTitle: string;
  relationTypeName: string;
  /** `null` : relation créée dans l'application (ou avant le journal). */
  createdByAssistant: AssistantOrigin | null;
}

export interface GraphNode {
  id: string;
  parentId: string | null;
  title: string;
  nodeType: NodeType;
  color: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  tagIds: string[];
  /** Ajouté par un assistant IA et pas encore validé. */
  assistantPending?: boolean;
}

/** Données légères du graphe : aucun contenu documentaire (§9). */
export interface GraphData {
  nodes: GraphNode[];
  edges: EdgeInfo[];
  relationTypes: RelationTypeInfo[];
}

/** Extrait de texte trouvé ; les termes trouvés sont encadrés par SEARCH_MARK_START et SEARCH_MARK_END. */
export interface SearchMatch {
  kind: 'node' | 'document';
  documentId: string | null;
  documentTitle: string | null;
  snippet: string;
}

/** Résultat de recherche regroupé par nœud (§6.9). */
export interface SearchHit {
  nodeId: string;
  nodeTitle: string;
  nodeType: NodeType;
  matches: SearchMatch[];
}

/** Bilan d'un export (§6.10). */
export interface ExportResult {
  folderPath: string;
  nodeCount: number;
  documentCount: number;
  attachmentCount: number;
}

/** Résultat d'une vérification d'intégrité (§6.10). */
export interface IntegrityReport {
  ok: boolean;
  checks: { name: string; ok: boolean; details: string[] }[];
}

/** Portée d'un export LLM (§6.7). */
export type LlmExportScope =
  | { kind: 'workspace' }
  | { kind: 'subtree'; nodeId: string }
  | { kind: 'neighborhood'; nodeId: string; depth: number };

export interface LlmExportOptions {
  scope: LlmExportScope;
  /** Taille maximale d'un fragment, en tokens du tokenizer indiqué. */
  maxTokens: number;
}

export interface LlmExportResult {
  folderPath: string;
  nodeCount: number;
  documentCount: number;
  chunkCount: number;
  /** Tokenizer utilisé pour les comptages (nom, version, encodage). */
  tokenizer: string;
}

export interface NodePosition {
  id: string;
  x: number;
  y: number;
  z: number;
}

/** Entrée du journal des modifications d'un assistant IA (via MCP). */
export interface AssistantChange {
  id: string;
  createdAt: string;
  /** Nom de l'assistant, tel qu'il se présente au serveur MCP. */
  client: string | null;
  action: AssistantAction;
  /** Nœud concerné, s'il existe encore. */
  nodeId: string | null;
  nodeTitle: string | null;
  summary: string;
  undoneAt: string | null;
  /** Élément validé par l'utilisateur (l'entrée reste dans le journal). */
  validatedAt: string | null;
}
