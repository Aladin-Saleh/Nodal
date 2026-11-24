import { useEffect, useState } from 'react';
import type { MergePreview, MergeSide } from '../../../shared/model';
import { useClient, useReportError } from '../../app/context';
import { Modal } from '../../components/Modal';

const plural = (count: number, one: string, many: string) =>
  `${count} ${count > 1 ? many : one}`;

function describe(side: MergeSide): string {
  return [
    side.hasSummary ? 'un résumé' : 'pas de résumé',
    plural(side.documents, 'document', 'documents'),
    plural(side.relations, 'relation', 'relations'),
    plural(side.children, 'sous-nœud', 'sous-nœuds'),
    plural(side.attachments, 'pièce jointe', 'pièces jointes'),
  ].join(', ');
}

/** Fusion de deux nœuds : choix de celui qui reste, puis confirmation. */
export function MergeDialog({
  firstId,
  secondId,
  onSubmit,
  onCancel,
}: {
  firstId: string;
  secondId: string;
  onSubmit(keepId: string, dropId: string): void;
  onCancel(): void;
}) {
  const client = useClient();
  const reportError = useReportError();
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [keepId, setKeepId] = useState('');

  useEffect(() => {
    let cancelled = false;
    client.call('node:mergePreview', { firstId, secondId }).then(
      (loaded) => {
        if (cancelled) return;
        setPreview(loaded);
        setKeepId(loaded.keepId);
      },
      (error: unknown) => {
        if (!cancelled) reportError(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, reportError, firstId, secondId]);

  const sides = preview ? [preview.first, preview.second] : [];
  const drop = sides.find((side) => side.id !== keepId);
  return (
    <Modal
      title="Fusionner deux nœuds"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="secondary" onClick={onCancel}>
            Annuler
          </button>
          <button
            type="button"
            disabled={!drop}
            onClick={() => drop && onSubmit(keepId, drop.id)}
          >
            Fusionner
          </button>
        </>
      }
    >
      {!preview ? (
        <p className="muted">Chargement…</p>
      ) : (
        <>
          <fieldset className="merge-sides">
            <legend>Nœud à garder</legend>
            {sides.map((side) => (
              <label key={side.id} className="checkbox">
                <input
                  type="radio"
                  name="merge-keep"
                  checked={side.id === keepId}
                  onChange={() => setKeepId(side.id)}
                />
                <span>
                  {side.title}
                  <br />
                  <span className="muted">{describe(side)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p>
            « {drop?.title} » disparaît ; ses documents, sous-nœuds, relations,
            pièces jointes, tags et fichiers ancrés passent au nœud gardé, et
            les liens qui le visent sont redirigés. Rien de ce que le nœud gardé
            contient déjà n’est remplacé.
          </p>
          <p className="muted">
            L’espace est d’abord sauvegardé à côté de son fichier.
          </p>
        </>
      )}
    </Modal>
  );
}
