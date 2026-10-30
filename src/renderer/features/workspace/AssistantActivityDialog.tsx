import { useCallback, useEffect, useState } from 'react';
import type { AssistantChange } from '../../../shared/model';
import { Modal } from '../../components/Modal';
import { useClient, useReportError, useRunner } from '../../app/context';

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/**
 * Journal des modifications faites par un assistant IA (serveur MCP), plus
 * récentes d'abord. Chaque entrée peut être annulée si l'élément n'a pas été
 * modifié depuis ; le refus est expliqué dans le bandeau d'erreur. À remonter
 * (prop `key`) après une modification externe pour recharger la liste.
 */
export function AssistantActivityDialog({
  onNavigate,
  onChanged,
  onClose,
}: {
  onNavigate(nodeId: string): void;
  /** Une annulation a modifié l'espace. */
  onChanged(): void;
  onClose(): void;
}) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const [changes, setChanges] = useState<AssistantChange[] | null>(null);

  const reload = useCallback(
    () => client.call('assistant:listChanges').then(setChanges, reportError),
    [client, reportError],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const undo = async (change: AssistantChange) => {
    const done = await run(() =>
      client.call('assistant:undo', { id: change.id }),
    );
    if (done === undefined) return;
    onChanged();
    void reload();
  };

  return (
    <Modal
      title="Activité de l’assistant IA"
      size="large"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <p className="muted">
        Modifications faites par un assistant connecté via MCP. Une modification
        peut être annulée tant que l’élément n’a pas été retouché depuis ;
        annulez les plus récentes d’abord.
      </p>
      {changes === null ? (
        <p className="muted">Chargement…</p>
      ) : changes.length === 0 ? (
        <p className="muted">Aucune modification pour l’instant.</p>
      ) : (
        <ul className="assistant-changes">
          {changes.map((change) => (
            <li
              key={change.id}
              className={change.undoneAt ? 'undone' : undefined}
            >
              <div className="assistant-change-text">
                <span>{change.summary}</span>
                <span className="muted">
                  {dateFormat.format(new Date(change.createdAt))}
                  {change.client && ` · ${change.client}`}
                  {change.undoneAt &&
                    ` · annulée le ${dateFormat.format(new Date(change.undoneAt))}`}
                </span>
              </div>
              <div className="assistant-change-actions">
                {change.nodeId && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onNavigate(change.nodeId!)}
                  >
                    Afficher
                  </button>
                )}
                {!change.undoneAt && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void undo(change)}
                  >
                    Annuler
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
