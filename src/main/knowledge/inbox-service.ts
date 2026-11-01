/**
 * Boîte de réception : nœud racine qui reçoit les captures rapides, à ranger
 * ensuite (glisser-déposer ou « Déplacer vers… »). Son identifiant est retenu
 * dans workspace_settings ; à défaut (nœud supprimé, espace importé), une
 * racine portant le titre attendu est reprise, sinon elle est créée.
 */
import { CAPTURE_NOTE_TITLE, INBOX_TITLE } from '../../shared/quick-capture';
import type { CaptureInput } from '../../shared/quick-capture';
import { inTransaction } from '../database/transaction';
import type { ServiceContext } from './context';
import { DocumentService } from './document-service';
import { NodeService } from './node-service';

const INBOX_KEY = 'inbox.nodeId';

function storedInboxId(ctx: ServiceContext): string | null {
  const row = ctx.db
    .prepare(
      'SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?',
    )
    .get(ctx.workspaceId, INBOX_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

function rememberInbox(ctx: ServiceContext, id: string): void {
  ctx.db
    .prepare(
      `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value`,
    )
    .run(ctx.workspaceId, INBOX_KEY, id);
}

function isRoot(ctx: ServiceContext, id: string): boolean {
  return (
    ctx.db
      .prepare(
        'SELECT 1 FROM node WHERE id = ? AND workspace_id = ? AND parent_id IS NULL',
      )
      .get(id, ctx.workspaceId) !== undefined
  );
}

/** Boîte de réception existante, sans rien créer ; `null` s'il n'y en a pas. */
export function findInbox(ctx: ServiceContext): string | null {
  const stored = storedInboxId(ctx);
  if (stored && isRoot(ctx, stored)) return stored;
  const byTitle = ctx.db
    .prepare(
      `SELECT id FROM node WHERE workspace_id = ? AND parent_id IS NULL AND title = ?
       ORDER BY sort_order, rowid LIMIT 1`,
    )
    .get(ctx.workspaceId, INBOX_TITLE) as { id: string } | undefined;
  return byTitle?.id ?? null;
}

/** Boîte de réception de l'espace, créée au besoin. */
export function ensureInbox(ctx: ServiceContext): string {
  return inTransaction(ctx.db, () => {
    const id =
      findInbox(ctx) ??
      new NodeService(() => ctx).create({
        parentId: null,
        title: INBOX_TITLE,
        nodeType: 'generic',
      }).id;
    if (storedInboxId(ctx) !== id) rememberInbox(ctx, id);
    return id;
  });
}

/**
 * Range une capture dans la boîte de réception : un nœud par capture, la
 * note éventuelle dans un document Markdown. Tout ou rien.
 */
export function captureToInbox(
  ctx: ServiceContext,
  input: CaptureInput,
): { nodeId: string; inboxId: string } {
  const provider = () => ctx;
  return inTransaction(ctx.db, () => {
    const inboxId = ensureInbox(ctx);
    const node = new NodeService(provider).create({
      parentId: inboxId,
      title: input.title,
      nodeType: 'generic',
    });
    if (input.note !== null) {
      const documents = new DocumentService(provider);
      const document = documents.create({
        nodeId: node.id,
        title: CAPTURE_NOTE_TITLE,
        contentType: 'markdown',
      });
      documents.update({ id: document.id, body: input.note });
    }
    return { nodeId: node.id, inboxId };
  });
}
