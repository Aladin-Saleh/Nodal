/**
 * Fenêtre de capture rapide (raccourci global) : un titre, une note, rangés
 * dans la boîte de réception de l'espace ouvert ou du dernier espace.
 * Entrée (dans le titre) ou Ctrl+Entrée enregistre, Échap ferme.
 */
import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { TITLE_MAX_LENGTH } from '../../../shared/domain';
import { INBOX_TITLE, type CaptureTarget } from '../../../shared/quick-capture';
import { PreferencesProvider } from '../../app/preferences';
import { describeError, type NodalClient } from '../../services/nodal-client';

/** Délai d'affichage de la confirmation avant de fermer la fenêtre. */
const CLOSE_DELAY_MS = 700;

export interface CaptureAppProps {
  client: NodalClient;
  /** Ferme la fenêtre (injecté pour les tests). */
  close?: () => void;
}

export function CaptureApp({
  client,
  close = () => window.close(),
}: CaptureAppProps) {
  const titleId = useId();
  const noteId = useId();
  const [target, setTarget] = useState<CaptureTarget | null | undefined>();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Capture rapide — Nodal';
    client.call('capture:getTarget').then(setTarget, (err: unknown) => {
      setTarget(null);
      setError(describeError(err));
    });
  }, [client]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!title.trim() || saving || saved) return;
    setSaving(true);
    setError(null);
    try {
      const result = await client.call('capture:submit', {
        title: title.trim(),
        note,
      });
      setSaved(result.workspaceName);
      setTimeout(close, CLOSE_DELAY_MS);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <PreferencesProvider client={client} onError={() => undefined}>
      <main className="capture" onKeyDown={onKeyDown}>
        <h1 className="capture-title">Capture rapide</h1>
        {target === null && !error ? (
          <p className="warning" role="alert">
            Aucun espace récent : ouvrez ou créez un espace dans Nodal.
          </p>
        ) : (
          <form className="form" onSubmit={(event) => void submit(event)}>
            <label htmlFor={titleId}>Titre</label>
            <input
              id={titleId}
              type="text"
              value={title}
              maxLength={TITLE_MAX_LENGTH}
              autoFocus
              disabled={Boolean(saved)}
              onChange={(event) => setTitle(event.target.value)}
            />
            <label htmlFor={noteId}>Note</label>
            <textarea
              id={noteId}
              rows={5}
              value={note}
              placeholder="Facultative (Markdown)"
              disabled={Boolean(saved)}
              onChange={(event) => setNote(event.target.value)}
            />
            <p className="muted capture-target">
              {target
                ? `Rangé dans « ${target.workspaceName} » › ${INBOX_TITLE}${target.open ? '' : ' (espace fermé)'}`
                : '…'}
            </p>
            {error && (
              <p className="warning" role="alert">
                {error}
              </p>
            )}
            {saved && (
              <p className="capture-saved" role="status">
                Enregistré dans « {saved} ».
              </p>
            )}
            <div className="capture-actions">
              <span className="muted">Ctrl + Entrée · Échap</span>
              <button type="button" className="secondary" onClick={close}>
                Annuler
              </button>
              <button
                type="submit"
                disabled={!title.trim() || saving || Boolean(saved) || !target}
              >
                Enregistrer
              </button>
            </div>
          </form>
        )}
      </main>
    </PreferencesProvider>
  );
}
