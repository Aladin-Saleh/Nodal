import { useEffect, useState } from 'react';
import type { Backlink } from '../../../shared/model';
import { useClient, useReportError } from '../../app/context';

export interface BacklinkListProps {
  nodeId: string;
  /** Change quand des liens ont pu changer (recharger la liste). */
  revision: number;
  onNavigate(id: string): void;
  onOpenDocument(documentId: string, nodeId: string): void;
}

/** « Mentionné dans » : documents qui contiennent un lien [[...]] vers ce nœud. */
export function BacklinkList({
  nodeId,
  revision,
  onNavigate,
  onOpenDocument,
}: BacklinkListProps) {
  const client = useClient();
  const reportError = useReportError();
  const [mentions, setMentions] = useState<Backlink[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    client.call('node:backlinks', { id: nodeId }).then(
      (found) => {
        if (!cancelled) setMentions(found);
      },
      (error: unknown) => {
        if (!cancelled) reportError(error);
      },
    );
    return () => {
      cancelled = true;
    };
    // `revision` : relire quand des liens ont pu changer ailleurs.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [client, reportError, nodeId, revision]);

  if (mentions === null) return <p className="muted">Chargement…</p>;
  if (mentions.length === 0) {
    return <p className="muted">Aucun document ne mentionne ce nœud.</p>;
  }
  return (
    <ul className="backlink-list">
      {mentions.map((mention) => (
        <li key={mention.documentId}>
          <div className="backlink-source">
            <button
              type="button"
              className="link-button"
              onClick={() => onNavigate(mention.nodeId)}
            >
              {mention.nodeTitle}
            </button>
            <span className="muted"> · </span>
            <button
              type="button"
              className="link-button"
              title="Ouvrir le document"
              onClick={() => onOpenDocument(mention.documentId, mention.nodeId)}
            >
              {mention.documentTitle}
            </button>
          </div>
          <p className="backlink-snippet muted">{mention.snippet}</p>
        </li>
      ))}
    </ul>
  );
}
