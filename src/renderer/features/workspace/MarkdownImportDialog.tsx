/**
 * Import d'un dossier Markdown / coffre Obsidian : aperçu (ce qui sera
 * créé, liens non résolus, éléments ignorés), puis rapport. Le dossier est
 * choisi et lu par le main ; ici, seulement des chemins relatifs.
 */
import { useState } from 'react';
import type {
  MarkdownImportPreview,
  MarkdownImportReport,
  SkippedEntry,
  UnresolvedLink,
} from '../../../shared/markdown-import';
import { useClient, useRunner } from '../../app/context';
import { Modal } from '../../components/Modal';

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('fr-FR')} ${count > 1 ? many : one}`;

function Details({
  unresolved,
  unresolvedCount,
  skipped,
  skippedCount,
}: {
  unresolved: UnresolvedLink[];
  unresolvedCount: number;
  skipped: SkippedEntry[];
  skippedCount: number;
}) {
  return (
    <>
      {unresolvedCount > 0 && (
        <details className="import-details">
          <summary>
            {plural(unresolvedCount, 'lien non résolu', 'liens non résolus')}{' '}
            (gardés comme liens cassés, à corriger ensuite)
          </summary>
          <ul>
            {unresolved.map((link, index) => (
              <li key={index}>
                <span className="path">{link.note}</span> → [[{link.target}]]
              </li>
            ))}
            {unresolvedCount > unresolved.length && (
              <li className="muted">
                … et {unresolvedCount - unresolved.length} autres.
              </li>
            )}
          </ul>
        </details>
      )}
      {skippedCount > 0 && (
        <details className="import-details">
          <summary>
            {plural(skippedCount, 'élément ignoré', 'éléments ignorés')}
          </summary>
          <ul>
            {skipped.map((entry, index) => (
              <li key={index}>
                <span className="path">{entry.path}</span> : {entry.reason}
              </li>
            ))}
            {skippedCount > skipped.length && (
              <li className="muted">
                … et {skippedCount - skipped.length} autres.
              </li>
            )}
          </ul>
        </details>
      )}
    </>
  );
}

export function MarkdownImportDialog({
  preview,
  onImported,
  onClose,
}: {
  preview: MarkdownImportPreview;
  /** Import terminé : recharger l'espace et montrer le nœud racine. */
  onImported(report: MarkdownImportReport): void;
  onClose(): void;
}) {
  const client = useClient();
  const run = useRunner();
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<MarkdownImportReport | null>(null);

  const cancel = () => {
    if (!report) void client.call('markdownImport:cancel').catch(() => null);
    onClose();
  };

  const start = async () => {
    setImporting(true);
    const done = await run(() =>
      client.call('markdownImport:run', { token: preview.token }),
    );
    setImporting(false);
    if (done) {
      setReport(done);
      onImported(done);
    }
  };

  if (report) {
    return (
      <Modal
        title="Import terminé"
        onClose={onClose}
        footer={
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        }
      >
        <p role="status">
          « {preview.folderName} » importé :{' '}
          {plural(report.nodeCount, 'nœud', 'nœuds')},{' '}
          {plural(report.documentCount, 'document', 'documents')},{' '}
          {plural(report.attachmentCount, 'pièce jointe', 'pièces jointes')},{' '}
          {plural(report.relationCount, 'relation', 'relations')} issues des
          liens.
        </p>
        <p className="muted">
          Sauvegarde faite avant l’import :{' '}
          <span className="path">{report.backupPath}</span>
        </p>
        <Details {...report} />
      </Modal>
    );
  }

  const empty = preview.noteCount === 0;
  return (
    <Modal
      title={`Importer « ${preview.folderName} »`}
      onClose={cancel}
      footer={
        <>
          <button type="button" className="secondary" onClick={cancel}>
            Annuler
          </button>
          <button
            type="button"
            disabled={empty || importing}
            onClick={() => void start()}
          >
            {importing ? 'Import…' : 'Importer'}
          </button>
        </>
      }
    >
      {empty ? (
        <p className="warning" role="alert">
          Aucune note Markdown (.md) dans ce dossier.
        </p>
      ) : (
        <>
          <p>
            Un nœud « {preview.folderName} » sera créé à la racine, avec{' '}
            {plural(preview.folderCount, 'dossier', 'dossiers')} et{' '}
            {plural(preview.noteCount, 'note', 'notes')} (un nœud et un document
            par note).
          </p>
          <ul className="import-summary">
            <li>
              {plural(preview.linkCount, 'lien', 'liens')} entre notes ou vers
              des nœuds existants (relations « est lié à »)
            </li>
            <li>
              {plural(
                preview.attachmentCount,
                'pièce jointe référencée',
                'pièces jointes référencées',
              )}
            </li>
            <li>
              {plural(
                preview.frontMatterCount,
                'note avec front-matter',
                'notes avec front-matter',
              )}{' '}
              (type, résumé, tags)
            </li>
          </ul>
          <Details {...preview} />
          <p className="muted">
            Une sauvegarde de l’espace est faite juste avant l’import, à côté de
            son fichier.
          </p>
        </>
      )}
    </Modal>
  );
}
