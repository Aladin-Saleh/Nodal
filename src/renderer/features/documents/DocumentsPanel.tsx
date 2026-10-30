import { useId, useState, type FormEvent } from 'react';
import {
  CODE_LANGUAGES,
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  TITLE_MAX_LENGTH,
  type ContentType,
} from '../../../shared/domain';
import type { DocumentSummary } from '../../../shared/model';
import { useClient, useRunner, useSaveTracker } from '../../app/context';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { DocumentEditor } from './DocumentEditor';

export type Language = (typeof CODE_LANGUAGES)[number];

export interface DocumentsPanelProps {
  nodeId: string;
  documents: DocumentSummary[];
  /** Change après une modification externe : l'éditeur est rechargé. */
  revision?: number;
  onChanged(): void;
}

/** Liste ordonnée des documents d'un nœud, en onglets, et l'éditeur courant. */
export function DocumentsPanel({
  nodeId,
  documents,
  revision = 0,
  onChanged,
}: DocumentsPanelProps) {
  const client = useClient();
  const run = useRunner();
  const tracker = useSaveTracker();
  const [selectedId, setSelectedId] = useState<string | null>(
    documents[0]?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DocumentSummary | null>(
    null,
  );

  const selected =
    documents.find((doc) => doc.id === selectedId) ?? documents[0] ?? null;
  const position = selected ? documents.indexOf(selected) : -1;

  const create = async (
    title: string,
    contentType: ContentType,
    language: Language | null,
  ) => {
    setCreating(false);
    const created = await run(() =>
      client.call('document:create', { nodeId, title, contentType, language }),
    );
    if (created) {
      setSelectedId(created.id);
      onChanged();
    }
  };

  const shift = async (offset: -1 | 1) => {
    if (!selected) return;
    const ids = documents.map((doc) => doc.id);
    const target = position + offset;
    if (target < 0 || target >= ids.length) return;
    [ids[position], ids[target]] = [ids[target]!, ids[position]!];
    const done = await run(() =>
      client.call('document:reorder', { nodeId, orderedIds: ids }),
    );
    if (done !== undefined) onChanged();
  };

  const remove = async (doc: DocumentSummary) => {
    setPendingDelete(null);
    // Écrire d'abord les modifications en attente du document supprimé.
    await tracker.flushAll();
    const done = await run(() =>
      client.call('document:delete', { id: doc.id }),
    );
    if (done !== undefined) {
      setSelectedId(null);
      onChanged();
    }
  };

  return (
    <section className="documents" aria-label="Documents">
      <div className="tabs-bar">
        <div role="tablist" aria-label="Documents du nœud" className="tabs">
          {documents.map((doc) => (
            <button
              key={doc.id}
              type="button"
              role="tab"
              aria-selected={doc.id === selected?.id}
              className="tab"
              onClick={() => setSelectedId(doc.id)}
            >
              {doc.title}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => setCreating(true)}
        >
          + Document
        </button>
      </div>

      {selected ? (
        <>
          <div className="toolbar" aria-label="Actions sur le document">
            <button
              type="button"
              className="secondary"
              disabled={position <= 0}
              onClick={() => void shift(-1)}
              title="Déplacer avant"
              aria-label="Déplacer le document avant"
            >
              ←
            </button>
            <button
              type="button"
              className="secondary"
              disabled={position === documents.length - 1}
              onClick={() => void shift(1)}
              title="Déplacer après"
              aria-label="Déplacer le document après"
            >
              →
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setPendingDelete(selected)}
            >
              Supprimer le document
            </button>
          </div>
          <DocumentEditor
            key={`${selected.id}:${revision}`}
            documentId={selected.id}
            onMetadataChanged={onChanged}
          />
        </>
      ) : (
        <div className="empty-state">
          <p className="muted">Ce nœud ne contient aucun document.</p>
          <button type="button" onClick={() => setCreating(true)}>
            Ajouter un document
          </button>
        </div>
      )}

      {creating && (
        <NewDocumentDialog
          onSubmit={create}
          onCancel={() => setCreating(false)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={`Supprimer « ${pendingDelete.title} » ?`}
          confirmLabel="Supprimer définitivement"
          danger
          onConfirm={() => void remove(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        >
          <p>
            Le document et son contenu seront supprimés. Cette action est
            irréversible.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}

export function NewDocumentDialog({
  onSubmit,
  onCancel,
}: {
  onSubmit(
    title: string,
    contentType: ContentType,
    language: Language | null,
  ): void;
  onCancel(): void;
}) {
  const titleId = useId();
  const typeId = useId();
  const languageId = useId();
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState<ContentType>('markdown');
  const [language, setLanguage] = useState<Language | ''>('');
  const trimmed = title.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed) return;
    onSubmit(
      trimmed,
      contentType,
      contentType === 'code' && language ? language : null,
    );
  };

  return (
    <Modal title="Nouveau document" onClose={onCancel}>
      <form className="form" onSubmit={submit}>
        <label htmlFor={titleId}>Titre</label>
        <input
          id={titleId}
          type="text"
          value={title}
          maxLength={TITLE_MAX_LENGTH}
          data-autofocus
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor={typeId}>Type de contenu</label>
        <select
          id={typeId}
          value={contentType}
          onChange={(event) =>
            setContentType(event.target.value as ContentType)
          }
        >
          {CONTENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CONTENT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        {contentType === 'code' && (
          <>
            <label htmlFor={languageId}>Langage</label>
            <select
              id={languageId}
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as Language | '')
              }
            >
              <option value="">Non précisé</option>
              {CODE_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </>
        )}
        <p className="muted">
          Le type d’un document ne peut plus être changé ensuite.
        </p>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" disabled={!trimmed}>
            Créer
          </button>
        </div>
      </form>
    </Modal>
  );
}
