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
