/**
 * Lignes SQLite et conversions vers les objets du modèle partagé.
 */
import type { ContentType, NodeType } from '../../shared/domain';
import type {
  AttachmentInfo,
  DocumentInfo,
  DocumentSummary,
  NodeSummary,
  TagInfo,
} from '../../shared/model';

export interface NodeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  node_type: NodeType;
  summary: string | null;
  color: string | null;
  position_x: number | null;
  position_y: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  node_id: string;
  title: string;
  content_type: ContentType;
  language: string | null;
  body: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  usage_count: number;
}

export interface AttachmentRow {
  id: string;
  node_id: string | null;
  document_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  created_at: string;
}

export const NODE_COLUMNS =
  'id, workspace_id, parent_id, title, node_type, summary, color, position_x, position_y, sort_order, created_at, updated_at';
export const DOCUMENT_SUMMARY_COLUMNS =
  'id, node_id, title, content_type, language, sort_order, updated_at';
export const DOCUMENT_COLUMNS = `${DOCUMENT_SUMMARY_COLUMNS}, body, created_at`;
/** Colonnes d'une pièce jointe, sans le BLOB. */
export const ATTACHMENT_COLUMNS =
  'id, node_id, document_id, file_name, mime_type, size_bytes, checksum, created_at';

export function toNodeSummary(row: NodeRow): NodeSummary {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    nodeType: row.node_type,
    color: row.color,
    sortOrder: row.sort_order,
  };
}

export function toDocumentSummary(
  row: Omit<DocumentRow, 'body' | 'created_at'>,
): DocumentSummary {
  return {
    id: row.id,
    nodeId: row.node_id,
    title: row.title,
    contentType: row.content_type,
    language: row.language,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

export function toDocumentInfo(row: DocumentRow): DocumentInfo {
  return {
    ...toDocumentSummary(row),
    body: row.body,
    createdAt: row.created_at,
  };
}

export function toTagInfo(row: TagRow): TagInfo {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    usageCount: row.usage_count,
  };
}

export function toAttachmentInfo(row: AttachmentRow): AttachmentInfo {
  return {
    id: row.id,
    nodeId: row.node_id,
    documentId: row.document_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    createdAt: row.created_at,
  };
}

/** Typage des résultats de node:sqlite (qui retourne des objets génériques). */
export function asRows<T>(value: unknown[]): T[] {
  return value as T[];
}

export function asRow<T>(value: unknown): T | undefined {
  return value as T | undefined;
}
