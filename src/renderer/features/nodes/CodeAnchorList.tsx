import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  ANCHOR_PATTERN_MAX_LENGTH,
  type NodeAnchors,
} from '../../../shared/code-anchors';
import { useClient, useReportError, useRunner } from '../../app/context';

export interface CodeAnchorListProps {
  nodeId: string;
  /** Change après un enregistrement de document (date de référence). */
  revision: number;
  /** Ancrage ou vérification modifiés : l'arbre met ses badges à jour. */
  onChanged(): void;
}

const formatDate = (iso: string) => new Date(iso).toLocaleString();

/**
 * Fichiers du code ancrés au nœud : motifs (chemins ou glob relatifs aux
 * dossiers de code de l'espace), fichiers trouvés ou introuvables, et
 * avertissement « possiblement obsolète » si des fichiers ont changé depuis
 * la dernière mise à jour du nœud.
 */
export function CodeAnchorList({
  nodeId,
  revision,
  onChanged,
}: CodeAnchorListProps) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const inputId = useId();
  const [state, setState] = useState<NodeAnchors | null>(null);
  const [reload, setReload] = useState(0);
  const [pattern, setPattern] = useState('');

  useEffect(() => {
    let cancelled = false;
    client.call('anchor:listForNode', { id: nodeId }).then(
      (loaded) => {
        if (!cancelled) setState(loaded);
      },
      (error: unknown) => {
        if (!cancelled) reportError(error);
      },
    );
    return () => {
      cancelled = true;
    };
    // `revision`, `reload` : relire après un enregistrement ou une action.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [client, reportError, nodeId, revision, reload]);

  if (!state) return null;
  const patterns = state.anchors.map((anchor) => anchor.pattern);

  const changed = () => {
    setReload((count) => count + 1);
    onChanged();
  };
  const save = async (next: string[]) => {
    const saved = await run(() =>
      client.call('anchor:set', { nodeId, patterns: next }),
    );
    if (saved) changed();
    return saved !== undefined;
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!pattern.trim()) return;
    if (await save([...patterns, pattern])) setPattern('');
  };
  const pick = async () => {
    const saved = await run(() =>
      client.call('anchor:pickFiles', { id: nodeId }),
    );
    if (saved) changed();
  };
  const markReviewed = async () => {
    const done = await run(() =>
      client.call('anchor:markReviewed', { id: nodeId }),
    );
    if (done !== undefined) changed();
  };

  const { stale } = state;
  return (
    <section className="code-anchors" aria-label="Fichiers du code">
      <h3>Fichiers du code</h3>
      {stale && (
        <div className="stale-warning" role="status">
          <p>
            <strong>Possiblement obsolète</strong> :{' '}
            {stale.fileCount === 1
              ? '1 fichier modifié'
              : `${stale.fileCount} fichiers modifiés`}{' '}
            depuis la dernière mise à jour ({formatDate(stale.since)}).
          </p>
          <ul className="stale-files">
            {stale.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>{' '}
                <span className="muted">
                  {file.deleted
                    ? 'supprimé'
                    : file.added
                      ? 'ajouté'
                      : 'modifié'}{' '}
                  le {formatDate(file.changedAt)}
                </span>
              </li>
            ))}
            {stale.fileCount > stale.files.length && (
              <li className="muted">
                … et {stale.fileCount - stale.files.length} autres
              </li>
            )}
          </ul>
          <button
            type="button"
            className="secondary"
            title="La documentation reflète le code actuel"
            onClick={() => void markReviewed()}
          >
            Marquer comme à jour
          </button>
        </div>
      )}
      {state.anchors.length > 0 && (
        <ul className="anchor-list">
          {state.anchors.map((anchor) => (
            <li key={anchor.pattern}>
              <div className="anchor-row">
                <code className="anchor-pattern">{anchor.pattern}</code>
                {anchor.count === 0 ? (
                  <span className="anchor-missing">introuvable</span>
                ) : (
                  <span className="muted">
                    {anchor.count === 1 && anchor.files[0] === anchor.pattern
                      ? 'trouvé'
                      : `${anchor.count}${anchor.truncated ? '+' : ''} fichier${anchor.count > 1 ? 's' : ''}`}
                  </span>
                )}
                <button
                  type="button"
                  className="link-button anchor-remove"
                  aria-label={`Retirer ${anchor.pattern}`}
                  title="Retirer"
                  onClick={() =>
                    void save(patterns.filter((p) => p !== anchor.pattern))
                  }
                >
                  ×
                </button>
              </div>
              {anchor.count > 0 && anchor.files[0] !== anchor.pattern && (
                <details className="anchor-files">
                  <summary>Voir les fichiers</summary>
                  <ul>
                    {anchor.files.map((file) => (
                      <li key={file}>
                        <code>{file}</code>
                      </li>
                    ))}
                    {anchor.count > anchor.files.length && (
                      <li className="muted">
                        … et {anchor.count - anchor.files.length} autres
                      </li>
                    )}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {!state.hasRoots && (
        <p className="muted">
          Déclarez un dossier de code dans les paramètres de l’espace pour
          retrouver ces fichiers et détecter la documentation obsolète.
        </p>
      )}
      <form className="inline-form" onSubmit={add}>
        <label htmlFor={inputId} className="visually-hidden">
          Fichier ou motif à ancrer
        </label>
        <input
          id={inputId}
          type="text"
          value={pattern}
          maxLength={ANCHOR_PATTERN_MAX_LENGTH}
          placeholder="src/mcp/** ou chemin du fichier"
          onChange={(event) => setPattern(event.target.value)}
        />
        <button type="submit" className="secondary" disabled={!pattern.trim()}>
          Ancrer
        </button>
      </form>
      {state.hasRoots && (
        <button type="button" className="secondary" onClick={() => void pick()}>
          Choisir des fichiers…
        </button>
      )}
    </section>
  );
}
