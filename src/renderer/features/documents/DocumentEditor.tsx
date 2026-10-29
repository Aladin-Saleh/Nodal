import { useEffect, useId, useState } from 'react';
import {
  CODE_LANGUAGES,
  CONTENT_TYPE_LABELS,
  TITLE_MAX_LENGTH,
} from '../../../shared/domain';
import type { DocumentInfo } from '../../../shared/model';
import {
  useAutosave,
  useClient,
  useReportError,
  useRunner,
} from '../../app/context';

/** Erreur de syntaxe JSON affichée sans bloquer l'édition (§6.6). */
export function jsonError(body: string): string | null {
  if (body.trim() === '') return null;
  try {
    JSON.parse(body);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'JSON invalide';
  }
}

export interface DocumentEditorProps {
  documentId: string;
  onMetadataChanged(): void;
}

/**
 * Éditeur texte d'un document, avec enregistrement automatique. Le contenu
 * est du texte inerte : rien n'est interprété ni exécuté. Les éditeurs riches
 * (coloration, prévisualisation Markdown, rendu Mermaid) arrivent au lot 4.
 * À remonter (prop `key`) quand le document change.
 */
export function DocumentEditor({
  documentId,
  onMetadataChanged,
}: DocumentEditorProps) {
  const client = useClient();
  const reportError = useReportError();
  const [document, setDocument] = useState<DocumentInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.call('document:get', { id: documentId }).then(
      (loaded) => {
        if (!cancelled) setDocument(loaded);
      },
      (error: unknown) => {
        if (!cancelled) reportError(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client, reportError, documentId]);

  if (!document) return <p className="muted">Chargement…</p>;
  return (
    <LoadedDocumentEditor
      document={document}
      onMetadataChanged={onMetadataChanged}
    />
  );
}

function LoadedDocumentEditor({
  document,
  onMetadataChanged,
}: {
  document: DocumentInfo;
  onMetadataChanged(): void;
}) {
  const client = useClient();
  const run = useRunner();
  const titleId = useId();
  const languageId = useId();
  const bodyId = useId();
  const [body, setBody] = useState(document.body);
  const [title, setTitle] = useState(document.title);
  const [language, setLanguage] = useState(document.language);

  useAutosave({
    key: `document:${document.id}:body`,
    value: body,
    save: (value) =>
      client.call('document:update', { id: document.id, body: value }),
  });

  const commitTitle = async () => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === document.title) {
      setTitle(document.title);
      return;
    }
    if (
      await run(() =>
        client.call('document:update', { id: document.id, title: trimmed }),
      )
    ) {
      onMetadataChanged();
    }
  };

  const changeLanguage = async (value: string) => {
    const next = value === '' ? null : value;
    setLanguage(next);
    await run(() =>
      client.call('document:update', {
        id: document.id,
        language: next as (typeof CODE_LANGUAGES)[number] | null,
      }),
    );
  };

  const isCode = document.contentType === 'code';
  const monospace =
    document.contentType !== 'markdown' && document.contentType !== 'text';
  const syntaxError = document.contentType === 'json' ? jsonError(body) : null;

  return (
    <div className="document-editor">
      <div className="document-meta">
        <label htmlFor={titleId} className="visually-hidden">
          Titre du document
        </label>
        <input
          id={titleId}
          className="document-title"
          type="text"
          value={title}
          maxLength={TITLE_MAX_LENGTH}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void commitTitle()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <span className="badge">
          {CONTENT_TYPE_LABELS[document.contentType]}
        </span>
        {isCode && (
          <>
            <label htmlFor={languageId} className="visually-hidden">
              Langage
            </label>
            <select
              id={languageId}
              value={language ?? ''}
              onChange={(event) => void changeLanguage(event.target.value)}
            >
              <option value="">Langage…</option>
              {CODE_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      <label htmlFor={bodyId} className="visually-hidden">
        Contenu du document
      </label>
      <textarea
        id={bodyId}
        className={monospace ? 'document-body monospace' : 'document-body'}
        value={body}
        spellCheck={!monospace}
        onChange={(event) => setBody(event.target.value)}
      />
      {syntaxError && (
        <p className="warning" role="status">
          JSON invalide : {syntaxError}
        </p>
      )}
    </div>
  );
}
