import { NodalError } from '../../shared/errors';
import type {
  CreateDocumentInput,
  ReorderDocumentsInput,
  UpdateDocumentInput,
} from '../../shared/ipc-contract';
import type { DocumentInfo, DocumentSummary } from '../../shared/model';
import { inTransaction } from '../database/transaction';
import { notFound, type ContextProvider, type ServiceContext } from './context';
import {
  DOCUMENT_COLUMNS,
  DOCUMENT_SUMMARY_COLUMNS,
  asRow,
  asRows,
  toDocumentInfo,
  toDocumentSummary,
  type DocumentRow,
} from './rows';

export function listNodeDocuments(
  ctx: ServiceContext,
  nodeId: string,
): DocumentSummary[] {
  return asRows<DocumentRow>(
    ctx.db
      .prepare(
        `SELECT ${DOCUMENT_SUMMARY_COLUMNS} FROM document
         WHERE node_id = ? ORDER BY sort_order, rowid`,
      )
      .all(nodeId),
  ).map(toDocumentSummary);
}

/** Un document n'est visible que si son nœud appartient à l'espace courant. */
function getDocumentRow(ctx: ServiceContext, id: string): DocumentRow {
  const found = asRow<DocumentRow>(
    ctx.db
      .prepare(
        `SELECT ${DOCUMENT_COLUMNS.split(', ')
          .map((column) => `d.${column}`)
          .join(', ')}
         FROM document d JOIN node n ON n.id = d.node_id
         WHERE d.id = ? AND n.workspace_id = ?`,
      )
      .get(id, ctx.workspaceId),
  );
  if (!found) throw notFound('Document');
  return found;
}

function assertNodeExists(ctx: ServiceContext, nodeId: string): void {
  const found = ctx.db
    .prepare('SELECT 1 FROM node WHERE id = ? AND workspace_id = ?')
    .get(nodeId, ctx.workspaceId);
  if (!found) throw notFound('Nœud');
}

function assertLanguageAllowed(
  contentType: string,
  language: string | null | undefined,
): void {
  if (language != null && contentType !== 'code') {
    throw new NodalError(
      'VALIDATION_ERROR',
      'Seuls les documents de code ont un langage.',
    );
  }
}

/** Documents typés d'un nœud : une liste ordonnée, un type par document (§13). */
export class DocumentService {
  constructor(private readonly context: ContextProvider) {}

  get(id: string): DocumentInfo {
    return toDocumentInfo(getDocumentRow(this.context(), id));
  }

  create(input: CreateDocumentInput): DocumentInfo {
    const ctx = this.context();
    assertNodeExists(ctx, input.nodeId);
    assertLanguageAllowed(input.contentType, input.language);
    const id = ctx.newId();
    const timestamp = ctx.now();
    ctx.db
      .prepare(
        `INSERT INTO document (id, node_id, title, content_type, language, body, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '',
           (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM document WHERE node_id = ?),
           ?, ?)`,
      )
      .run(
        id,
        input.nodeId,
        input.title,
        input.contentType,
        input.contentType === 'code' ? (input.language ?? null) : null,
        input.nodeId,
        timestamp,
        timestamp,
      );
    return this.get(id);
  }

  /** Le corps est enregistré tel quel, sans normalisation (§6.6). */
  update(input: UpdateDocumentInput): DocumentInfo {
    const ctx = this.context();
    const current = getDocumentRow(ctx, input.id);
    assertLanguageAllowed(current.content_type, input.language);
    ctx.db
      .prepare(
        'UPDATE document SET title = ?, body = ?, language = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        input.title ?? current.title,
        input.body ?? current.body,
        input.language === undefined ? current.language : input.language,
        ctx.now(),
        input.id,
      );
    return this.get(input.id);
  }

  /** Supprime le document et les pièces jointes qui lui sont rattachées. */
  delete(id: string): void {
    const ctx = this.context();
    getDocumentRow(ctx, id);
    inTransaction(ctx.db, () => {
      ctx.db.prepare('DELETE FROM attachment WHERE document_id = ?').run(id);
      ctx.db.prepare('DELETE FROM document WHERE id = ?').run(id);
    });
  }

  /** `orderedIds` doit contenir exactement les documents du nœud. */
  reorder(input: ReorderDocumentsInput): void {
    const ctx = this.context();
    assertNodeExists(ctx, input.nodeId);
    const existing = listNodeDocuments(ctx, input.nodeId).map((doc) => doc.id);
    const requested = new Set(input.orderedIds);
    if (
      requested.size !== input.orderedIds.length ||
      requested.size !== existing.length ||
      existing.some((id) => !requested.has(id))
    ) {
      throw new NodalError(
        'VALIDATION_ERROR',
        'La liste des documents à réordonner ne correspond pas au nœud.',
      );
    }
    const update = ctx.db.prepare(
      'UPDATE document SET sort_order = ? WHERE id = ?',
    );
    inTransaction(ctx.db, () => {
      input.orderedIds.forEach((id, index) => update.run(index, id));
    });
  }
}
