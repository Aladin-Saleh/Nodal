import { useEffect, useState } from 'react';
import type { LinkSuggestion } from '../../../shared/model';
import { useClient, useReportError, useRunner } from '../../app/context';

export interface SuggestionListProps {
  nodeId: string;
  /** Change après un enregistrement de document ou une relation modifiée. */
  revision: number;
  onNavigate(id: string): void;
  /** Une relation a été créée (directement ou par un lien). */
  onRelationsChanged(): void;
}

/**
 * « Relier ? » : autres nœuds dont le titre est cité par les documents de ce
 * nœud sans qu'une relation existe. Relier (relation « est lié à »), convertir
 * la mention en lien [[...]] ou ignorer (mémorisé). Rien n'est affiché sans
 * suggestion.
 */
export function SuggestionList({
  nodeId,
  revision,
  onNavigate,
  onRelationsChanged,
}: SuggestionListProps) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const [suggestions, setSuggestions] = useState<LinkSuggestion[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client.call('suggestion:listForNode', { id: nodeId }).then(
      (found) => {
        if (!cancelled) setSuggestions(found);
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

  if (suggestions.length === 0) return null;

  const accept = async (targetId: string, mode: 'relation' | 'link') => {
    const done = await run(() =>
      client.call('suggestion:accept', { sourceId: nodeId, targetId, mode }),
    );
    setReload((count) => count + 1);
    if (done !== undefined) onRelationsChanged();
  };
  const ignore = async (targetId: string) => {
    await run(() =>
      client.call('suggestion:ignore', { sourceId: nodeId, targetId }),
    );
    setReload((count) => count + 1);
  };

  return (
    <section className="suggestions" aria-label="Relier ?">
      <h3>Relier ?</h3>
      <ul className="suggestion-list">
        {suggestions.map((suggestion) => (
          <li key={suggestion.targetId}>
            <div>
              <button
                type="button"
                className="link-button"
                onClick={() => onNavigate(suggestion.targetId)}
              >
                {suggestion.targetTitle}
              </button>
              <span className="muted">
                {' '}
                cité dans « {suggestion.documentTitle} »
              </span>
            </div>
            <p className="backlink-snippet muted">{suggestion.snippet}</p>
            <div className="suggestion-actions">
              <button
                type="button"
                className="secondary"
                title="Créer une relation « est lié à »"
                onClick={() => void accept(suggestion.targetId, 'relation')}
              >
                Relier
              </button>
              <button
                type="button"
                className="secondary"
                title="Transformer la mention en lien [[…]] (qui crée la relation)"
                onClick={() => void accept(suggestion.targetId, 'link')}
              >
                En lien [[…]]
              </button>
              <button
                type="button"
                className="secondary"
                title="Ne plus proposer ce nœud ici"
                onClick={() => void ignore(suggestion.targetId)}
              >
                Ignorer
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
