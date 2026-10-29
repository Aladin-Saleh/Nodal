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
import { CodeEditor } from '../editor/CodeEditor';
import { MarkdownPreview, MermaidPreview } from '../editor/previews';

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
 * Éditeur d'un document (§6.3 à §6.6) : CodeMirror avec coloration, aperçu
 * Markdown ou rendu Mermaid, mise en forme JSON explicite, copie. Le contenu
 * reste du texte inerte : rien n'est exécuté. Enregistrement automatique.
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
  const [body, setBody] = useState(document.body);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'edit' | 'split' | 'preview'>('split');
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
  const hasPreview =
    document.contentType === 'markdown' || document.contentType === 'mermaid';
  const syntaxError = document.contentType === 'json' ? jsonError(body) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  /** Mise en forme JSON : action explicite, jamais automatique (§6.6). */
  const formatJson = () => {
    try {
      setBody(`${JSON.stringify(JSON.parse(body), null, 2)}\n`);
    } catch {
      // Bouton désactivé tant que le JSON est invalide.
    }
  };

  const editor = (
    <CodeEditor
      value={body}
      onChange={setBody}
      contentType={document.contentType}
      language={language}
      label={`Contenu du document ${document.title}`}
    />
  );
  const preview =
    document.contentType === 'markdown' ? (
      <MarkdownPreview source={body} />
    ) : (
      <MermaidPreview source={body} />
    );

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

      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Actions du document"
      >
        {hasPreview && (
          <div className="segmented" role="group" aria-label="Affichage">
            {(
              [
                ['edit', 'Édition'],
                ['split', 'Côte à côte'],
                ['preview', 'Aperçu'],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {document.contentType === 'json' && (
          <button
            type="button"
            className="secondary"
            disabled={syntaxError !== null || body.trim() === ''}
            onClick={formatJson}
          >
            Mettre en forme
          </button>
        )}
        <span className="toolbar-spacer" />
        <button type="button" className="secondary" onClick={() => void copy()}>
          {copied ? 'Copié ✓' : 'Copier'}
        </button>
      </div>

      {hasPreview ? (
        <div className={`editor-panes mode-${mode}`}>
          {mode !== 'preview' && editor}
          {mode !== 'edit' && preview}
        </div>
      ) : (
        editor
      )}
      {syntaxError && (
        <p className="warning" role="status">
          JSON invalide : {syntaxError}
        </p>
      )}
    </div>
  );
}
