/**
 * Objets du modèle documentaire échangés entre main et renderer (§5.1).
 * Ce sont des vues : le contenu binaire des pièces jointes n'y figure jamais.
 */
import type { ContentType, NodeType } from './domain';

export interface NodeSummary {
  id: string;
  parentId: string | null;
  title: string;
  nodeType: NodeType;
  color: string | null;
  sortOrder: number;
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

/**
 * Sort des enfants d'un nœud supprimé (§5.4) :
 * - `reparent` : les enfants remontent au niveau du nœud supprimé ;
 * - `delete` : tout le sous-arbre est supprimé.
 */
export type ChildrenStrategy = 'reparent' | 'delete';

export interface WorkspaceSettings {
  attachmentMaxSizeBytes: number;
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
export interface NodeRelation extends EdgeInfo {
  direction: 'outgoing' | 'incoming';
  otherNodeId: string;
  otherNodeTitle: string;
  relationTypeName: string;
}

export interface GraphNode {
  id: string;
  parentId: string | null;
  title: string;
  nodeType: NodeType;
  color: string | null;
  x: number | null;
  y: number | null;
  tagIds: string[];
}

/** Données légères du graphe : aucun contenu documentaire (§9). */
export interface GraphData {
  nodes: GraphNode[];
  edges: EdgeInfo[];
  relationTypes: RelationTypeInfo[];
}

export interface NodePosition {
  id: string;
  x: number;
  y: number;
}
