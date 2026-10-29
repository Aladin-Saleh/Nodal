import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import {
  NODE_TYPE_LABELS,
  SEARCH_MARK_END,
  SEARCH_MARK_START,
  SEARCH_QUERY_MAX_LENGTH,
} from '../../../shared/domain';
import type { SearchHit } from '../../../shared/model';
import { useClient, useReportError } from '../../app/context';

const DEBOUNCE_MS = 200;

/** Extrait avec les termes trouvés en surbrillance (sans HTML injecté). */
export function renderSnippet(snippet: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let rest = snippet;
  let key = 0;
  while (rest.length > 0) {
    const start = rest.indexOf(SEARCH_MARK_START);
    if (start === -1) {
      parts.push(rest);
      break;
    }
    if (start > 0) parts.push(rest.slice(0, start));
    const end = rest.indexOf(SEARCH_MARK_END, start + 1);
    const stop = end === -1 ? rest.length : end;
    parts.push(<mark key={key++}>{rest.slice(start + 1, stop)}</mark>);
    rest = end === -1 ? '' : rest.slice(end + 1);
  }
  return parts;
}

export interface SearchBoxProps {
  inputRef?: Ref<HTMLInputElement>;
  /** Résultats courants ; `null` quand la recherche est vide. */
  onResults(hits: SearchHit[] | null): void;
  onSelectNode(nodeId: string): void;
  onOpenDocument(documentId: string, nodeId: string): void;
}

/** Recherche par mots-clés dans les nœuds et leurs documents (§6.9). */
export function SearchBox({
  inputRef,
  onResults,
  onSelectNode,
  onOpenDocument,
}: SearchBoxProps) {
  const client = useClient();
  const reportError = useReportError();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const request = useRef(0);
  const onResultsRef = useRef(onResults);
  useEffect(() => {
    onResultsRef.current = onResults;
  });

  useEffect(() => {
    const current = ++request.current;
    if (query.trim() === '') {
      // Vidage immédiat : aucune requête à attendre.
      const timer = setTimeout(() => {
        setHits(null);
        onResultsRef.current(null);
      }, 0);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      client.call('search:query', { query }).then(
        (result) => {
          if (current !== request.current) return;
          setHits(result);
          setActive(0);
          onResultsRef.current(result);
        },
        (error: unknown) => {
          if (current === request.current) reportError(error);
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [client, query, reportError]);

  const choose = (hit: SearchHit) => {
    setOpen(false);
    onSelectNode(hit.nodeId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (open && hits) setOpen(false);
      else setQuery('');
      return;
    }
    if (!hits || hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = hits[active];
      if (hit) choose(hit);
    }
  };

  const showList = open && hits !== null;

  return (
    <div className="search-box">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Rechercher dans l’espace"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={
          showList && hits[active] ? `${listId}-${active}` : undefined
        }
        placeholder="Rechercher… (Ctrl+F)"
        value={query}
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {hits !== null && (
        <span className="search-count muted" aria-live="polite">
          {hits.length === 0
            ? 'Aucun résultat'
            : `${hits.length} nœud${hits.length > 1 ? 's' : ''}`}
        </span>
      )}
      {showList && hits.length > 0 && (
        <ul id={listId} className="search-results" role="listbox">
          {hits.map((hit, index) => (
            <li
              key={hit.nodeId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === active ? 'active' : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(hit)}
            >
              <div className="search-hit-title">
                <span
                  className={`type-dot type-${hit.nodeType}`}
                  aria-hidden="true"
                />
                <strong>{hit.nodeTitle}</strong>
                <span className="muted">{NODE_TYPE_LABELS[hit.nodeType]}</span>
              </div>
              {hit.matches.map((match, matchIndex) =>
                match.kind === 'document' && match.documentId ? (
                  <button
                    key={matchIndex}
                    type="button"
                    className="search-match link-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(false);
                      onOpenDocument(match.documentId!, hit.nodeId);
                    }}
                  >
                    <span className="search-doc">{match.documentTitle}</span>
                    {renderSnippet(match.snippet)}
                  </button>
                ) : (
                  <p key={matchIndex} className="search-match">
                    {renderSnippet(match.snippet)}
                  </p>
                ),
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
