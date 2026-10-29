import { useState } from 'react';
import type { AttachmentInfo } from '../../../shared/model';
import { useClient, useRunner } from '../../app/context';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export interface AttachmentListProps {
  nodeId: string;
  attachments: AttachmentInfo[];
  onChanged(): void;
}

/**
 * Pièces jointes d'un nœud. Elles ne sont jamais ouvertes ni exécutées :
 * seule une copie peut être enregistrée sur le disque.
 */
export function AttachmentList({
  nodeId,
  attachments,
  onChanged,
}: AttachmentListProps) {
  const client = useClient();
  const run = useRunner();
  const [pendingDelete, setPendingDelete] = useState<AttachmentInfo | null>(
    null,
  );

  const add = async () => {
    const added = await run(() => client.call('attachment:add', { nodeId }));
    if (added && added.length > 0) onChanged();
  };

  const remove = async (attachment: AttachmentInfo) => {
    setPendingDelete(null);
    const done = await run(() =>
      client.call('attachment:delete', { id: attachment.id }),
    );
    if (done !== undefined) onChanged();
  };

  return (
    <div className="attachments">
      {attachments.length === 0 ? (
        <p className="muted">Aucune pièce jointe.</p>
      ) : (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <span className="attachment-name" title={attachment.mimeType}>
                {attachment.fileName}
              </span>
              <span className="muted">{formatSize(attachment.sizeBytes)}</span>
              <button
                type="button"
                className="link-button"
                aria-label={`Enregistrer une copie de ${attachment.fileName}`}
                title="Enregistrer une copie…"
                onClick={() =>
                  void run(() =>
                    client.call('attachment:save', { id: attachment.id }),
                  )
                }
              >
                ⤓
              </button>
              <button
                type="button"
                className="link-button"
                aria-label={`Supprimer ${attachment.fileName}`}
                title="Supprimer"
                onClick={() => setPendingDelete(attachment)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="secondary" onClick={() => void add()}>
        Joindre des fichiers…
      </button>
      {pendingDelete && (
        <ConfirmDialog
          title={`Supprimer « ${pendingDelete.fileName} » ?`}
          confirmLabel="Supprimer"
          danger
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        >
          <p>La pièce jointe sera supprimée du fichier de l’espace.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
