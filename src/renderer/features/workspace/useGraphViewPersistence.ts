import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GraphCamera,
  GraphData,
  GraphViewInfo,
  GraphViewSettings,
} from '../../../shared/model';
import { useClient, useRunner } from '../../app/context';
import {
  fromGraphViewSettings,
  sameGraphViewSettings,
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

/** Vues graphe enregistrées et actions du sélecteur de la barre du graphe. */
export interface GraphViewsApi {
  views: readonly GraphViewInfo[];
  /** Vue appliquée en dernier, si elle existe encore. */
  active: GraphViewInfo | null;
  /** Les réglages courants diffèrent de ceux de la vue active. */
  modified: boolean;
  apply(id: string): void;
  /** Enregistre les réglages courants (et la caméra) sous un nouveau nom. */
  create(name: string, camera: GraphCamera | null): Promise<boolean>;
  /** Remplace les réglages et la caméra de la vue par les courants. */
  update(id: string, camera: GraphCamera | null): Promise<void>;
  rename(id: string, name: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  /** Vue ouverte avec l'espace ; `null` : reprendre la dernière session. */
  setDefault(id: string | null): Promise<void>;
}

/**
 * Réglages du graphe d'un espace :
 * - à l'ouverture, applique la vue par défaut s'il y en a une, sinon restaure
 *   l'état de travail de la dernière session (`view.graph`) ;
 * - enregistre l'état de travail à chaque changement, après un court délai
 *   (rien n'est écrit avant la restauration, pour ne pas écraser les réglages
 *   enregistrés par les valeurs par défaut) ;
 * - gère les vues nommées (créer, mettre à jour, renommer, supprimer).
 */
export function useGraphViewPersistence(
  graph: GraphData | null,
): GraphViewsApi {
  const client = useClient();
  const run = useRunner();
  const { graph: view, activeViewId } = useViewState();
  const dispatch = useViewDispatch();
  // `undefined` : lecture en cours.
  const [stored, setStored] = useState<GraphViewSettings | null | undefined>(
    undefined,
  );
  const [views, setViews] = useState<GraphViewInfo[] | undefined>(undefined);
  const restored = useRef(false);
  const pending = useRef<GraphViewSettings | null>(null);

  useEffect(() => {
    client.call('view:getGraph').then(setStored, () => setStored(null));
    client.call('graphView:list').then(setViews, () => setViews([]));
  }, [client]);

  useEffect(() => {
    if (restored.current || stored === undefined || !views || !graph) return;
    restored.current = true;
    const preferred = views.find((candidate) => candidate.isDefault);
    if (preferred) {
      dispatch({
        type: 'applyView',
        id: preferred.id,
        graph: fromGraphViewSettings(preferred.settings, knownIds(graph)),
        camera: preferred.camera,
      });
    } else if (stored) {
      dispatch({
        type: 'restoreGraph',
        graph: fromGraphViewSettings(stored, knownIds(graph)),
      });
    }
  }, [stored, views, graph, dispatch]);

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

  const list = useMemo(() => views ?? [], [views]);
  const active =
    list.find((candidate) => candidate.id === activeViewId) ?? null;
  const current = toGraphViewSettings(view);
  // Comparée telle qu'appliquée : sans les nœuds, tags et types disparus.
  const modified =
    active !== null &&
    graph !== null &&
    !sameGraphViewSettings(
      toGraphViewSettings(
        fromGraphViewSettings(active.settings, knownIds(graph)),
      ),
      current,
    );

  const reload = useCallback(async () => {
    const next = await run(() => client.call('graphView:list'));
    if (next) setViews(next);
  }, [client, run]);

  return {
    views: list,
    active,
    modified,
    apply: (id) => {
      const chosen = list.find((candidate) => candidate.id === id);
      if (!chosen || !graph) return;
      dispatch({
        type: 'applyView',
        id,
        graph: fromGraphViewSettings(chosen.settings, knownIds(graph)),
        camera: chosen.camera,
      });
    },
    create: async (name, camera) => {
      const created = await run(() =>
        client.call('graphView:create', { name, settings: current, camera }),
      );
      if (!created) return false;
      await reload();
      dispatch({ type: 'setActiveView', id: created.id });
      return true;
    },
    update: async (id, camera) => {
      const updated = await run(() =>
        client.call('graphView:update', { id, settings: current, camera }),
      );
      if (!updated) return;
      await reload();
      dispatch({ type: 'setActiveView', id });
    },
    rename: async (id, name) => {
      const renamed = await run(() =>
        client.call('graphView:update', { id, name }),
      );
      if (!renamed) return false;
      await reload();
      return true;
    },
    remove: async (id) => {
      const done = await run(() => client.call('graphView:delete', { id }));
      if (done === undefined) return;
      if (activeViewId === id) dispatch({ type: 'setActiveView', id: null });
      await reload();
    },
    setDefault: async (id) => {
      const done = await run(() => client.call('graphView:setDefault', { id }));
      if (done !== undefined) await reload();
    },
  };
}
