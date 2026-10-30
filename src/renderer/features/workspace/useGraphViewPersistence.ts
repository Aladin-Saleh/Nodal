import { useEffect, useRef, useState } from 'react';
import type { GraphData, GraphViewSettings } from '../../../shared/model';
import { useClient } from '../../app/context';
import {
  fromGraphViewSettings,
  toGraphViewSettings,
  type KnownIds,
} from './view-state';
import { useViewDispatch, useViewState } from './view-state-context';

/** Délai avant d'enregistrer un changement : regroupe les clics rapprochés. */
export const VIEW_SAVE_DELAY_MS = 500;

/**
 * Tags connus d'après le graphe (tags portés par au moins un nœud) : un
 * filtre sur un tag inutilisé n'affiche rien, l'oublier ne change rien.
 */
function knownIds(graph: GraphData): KnownIds {
  return {
    nodeIds: new Set(graph.nodes.map((node) => node.id)),
    tagIds: new Set(graph.nodes.flatMap((node) => node.tagIds)),
    relationTypeIds: new Set(graph.relationTypes.map((type) => type.id)),
  };
}

/**
 * Restaure les réglages du graphe (portée, filtres, replis) à l'ouverture de
 * l'espace, puis les enregistre à chaque changement, après un court délai.
 * Rien n'est écrit avant la restauration, pour ne pas écraser les réglages
 * enregistrés par les valeurs par défaut.
 */
export function useGraphViewPersistence(graph: GraphData | null): void {
  const client = useClient();
  const { graph: view } = useViewState();
  const dispatch = useViewDispatch();
  // `undefined` : lecture en cours.
  const [stored, setStored] = useState<GraphViewSettings | null | undefined>(
    undefined,
  );
  const restored = useRef(false);
  const pending = useRef<GraphViewSettings | null>(null);

  useEffect(() => {
    client.call('view:getGraph').then(setStored, () => setStored(null));
  }, [client]);

  useEffect(() => {
    if (restored.current || stored === undefined || !graph) return;
    restored.current = true;
    if (stored) {
      dispatch({
        type: 'restoreGraph',
        graph: fromGraphViewSettings(stored, knownIds(graph)),
      });
    }
  }, [stored, graph, dispatch]);

  useEffect(() => {
    if (!restored.current) return;
    const settings = toGraphViewSettings(view);
    pending.current = settings;
    const timer = setTimeout(() => {
      pending.current = null;
      // Affichage seulement : un échec d'écriture ne mérite pas d'alerte.
      client.call('view:saveGraph', settings).catch(() => undefined);
    }, VIEW_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [view, client]);

  // Fermeture de l'espace : enregistrer le dernier changement en attente.
  useEffect(
    () => () => {
      if (pending.current) {
        client.call('view:saveGraph', pending.current).catch(() => undefined);
      }
    },
    [client],
  );
}
