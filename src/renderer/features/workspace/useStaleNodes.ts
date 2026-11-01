import { useCallback, useEffect, useState } from 'react';
import type { StaleNode } from '../../../shared/code-anchors';
import { useClient } from '../../app/context';

const EMPTY: ReadonlyMap<string, StaleNode> = new Map();

/**
 * Nœuds dont la documentation est possiblement obsolète (fichiers ancrés
 * modifiés depuis). Vérifiés à l'ouverture, quand `revision` change (document
 * enregistré, écriture d'un assistant) et au retour dans la fenêtre : le code
 * a pu changer entre-temps. Le main garde le résultat en cache brièvement.
 * Un échec (git en panne…) laisse simplement les badges absents.
 */
export function useStaleNodes(revision: number) {
  const client = useClient();
  const [stale, setStale] = useState(EMPTY);

  const refresh = useCallback(
    () =>
      client.call('anchor:staleNodes').then(
        (list) => setStale(new Map(list.map((node) => [node.nodeId, node]))),
        () => setStale(EMPTY),
      ),
    [client],
  );

  useEffect(() => {
    void refresh();
    // `revision` : revérifier après une écriture.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [refresh, revision]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  return { stale, refresh };
}
