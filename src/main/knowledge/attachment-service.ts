import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NodalError } from '../../shared/errors';
import type { AttachmentInfo } from '../../shared/model';
import { inTransaction } from '../database/transaction';
import { notFound, type ContextProvider, type ServiceContext } from './context';
import {
  ATTACHMENT_COLUMNS,
  asRow,
  asRows,
  toAttachmentInfo,
  type AttachmentRow,
} from './rows';
import { readSettings } from './settings-service';

/**
 * Type MIME déduit de l'extension, à titre informatif uniquement : une pièce
 * jointe n'est jamais ouverte ni exécutée par l'application.
 */
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export function guessMimeType(fileName: string): string {
  return (
    MIME_TYPES[path.extname(fileName).toLowerCase()] ??
    'application/octet-stream'
  );
}

export function listNodeAttachments(
  ctx: ServiceContext,
  nodeId: string,
): AttachmentInfo[] {
  return asRows<AttachmentRow>(
    ctx.db
      .prepare(
        `SELECT ${ATTACHMENT_COLUMNS} FROM attachment
         WHERE node_id = ? ORDER BY created_at, rowid`,
      )
      .all(nodeId),
  ).map(toAttachmentInfo);
}

const formatMb = (bytes: number) =>
  `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;

/** Pièces jointes stockées en BLOB dans le fichier projet (§8). */
export class AttachmentService {
  constructor(private readonly context: ContextProvider) {}

  /**
   * Importe des fichiers dans un nœud, tout ou rien : si un fichier dépasse la
   * taille maximale ou est illisible, aucun n'est ajouté.
   */
  addFromPaths(nodeId: string, filePaths: string[]): AttachmentInfo[] {
    const ctx = this.context();
    const node = ctx.db
      .prepare('SELECT 1 FROM node WHERE id = ? AND workspace_id = ?')
      .get(nodeId, ctx.workspaceId);
    if (!node) throw notFound('Nœud');

    const { attachmentMaxSizeBytes } = readSettings(ctx);
    // Vérifier toutes les tailles avant de lire quoi que ce soit en mémoire.
    for (const filePath of filePaths) {
      let size: number;
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) throw new Error('not a file');
        size = stat.size;
      } catch (cause) {
        throw new NodalError(
          'IO_ERROR',
          `Impossible de lire « ${path.basename(filePath)} ».`,
          { cause },
        );
      }
      if (size > attachmentMaxSizeBytes) {
        throw new NodalError(
          'LIMIT_EXCEEDED',
          `« ${path.basename(filePath)} » (${formatMb(size)}) dépasse la taille maximale autorisée par pièce jointe (${formatMb(attachmentMaxSizeBytes)}).`,
        );
      }
    }

    const insert = ctx.db.prepare(
      `INSERT INTO attachment (id, node_id, document_id, file_name, data, mime_type, size_bytes, checksum, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    );
    const ids: string[] = [];
    inTransaction(ctx.db, () => {
      for (const filePath of filePaths) {
        let data: Buffer;
        try {
          data = fs.readFileSync(filePath);
        } catch (cause) {
          throw new NodalError(
            'IO_ERROR',
            `Impossible de lire « ${path.basename(filePath)} ».`,
            { cause },
          );
        }
        // Relu après le stat : le fichier a pu grossir entre-temps.
        if (data.byteLength > attachmentMaxSizeBytes) {
          throw new NodalError(
            'LIMIT_EXCEEDED',
            `« ${path.basename(filePath)} » dépasse la taille maximale autorisée.`,
          );
        }
        const id = ctx.newId();
        const fileName = path.basename(filePath);
        insert.run(
          id,
          nodeId,
          fileName,
          data,
          guessMimeType(fileName),
          data.byteLength,
          createHash('sha256').update(data).digest('hex'),
          ctx.now(),
        );
        ids.push(id);
      }
    });
    return ids.map((id) => this.get(id));
  }

  get(id: string): AttachmentInfo {
    const ctx = this.context();
    const found = asRow<AttachmentRow>(
      ctx.db
        .prepare(
          `SELECT ${ATTACHMENT_COLUMNS.split(', ')
            .map((column) => `a.${column}`)
            .join(', ')}
           FROM attachment a
           LEFT JOIN document d ON d.id = a.document_id
           JOIN node n ON n.id = COALESCE(a.node_id, d.node_id)
           WHERE a.id = ? AND n.workspace_id = ?`,
        )
        .get(id, ctx.workspaceId),
    );
    if (!found) throw notFound('Pièce jointe');
    return toAttachmentInfo(found);
  }

  /** Contenu binaire, pour l'enregistrer sur le disque à la demande. */
  getData(id: string): { fileName: string; data: Uint8Array } {
    const info = this.get(id);
    const { data } = this.context()
      .db.prepare('SELECT data FROM attachment WHERE id = ?')
      .get(id) as { data: Uint8Array };
    return { fileName: info.fileName, data };
  }

  delete(id: string): void {
    this.get(id);
    this.context().db.prepare('DELETE FROM attachment WHERE id = ?').run(id);
  }
}
