import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  GraphData,
  NodeDetail,
  NodePosition,
  NodeSummary,
  TagInfo,
} from '../../../shared/model';
import {
  useClient,
  useReportError,
  useReportInfo,
  useSaveTracker,
} from '../../app/context';

/**
 * Données de l'espace ouvert : nœuds, tags, graphe et fiche du nœud
 * sélectionné, rechargés après une modification locale ou une écriture d'un
 * assistant IA (serveur MCP).
 */
export function useWorkspaceData(selectedId: string | null) {
  const client = useClient();
  const reportError = useReportError();
  const reportInfo = useReportInfo();
  const tracker = useSaveTracker();

  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [relationsRevision, setRelationsRevision] = useState(0);
  /** Incrémenté à chaque modification externe appliquée (assistant IA). */
  const [externalRevision, setExternalRevision] = useState(0);

  /** Recharge l'arborescence et le graphe (données légères). */
  const refreshNodes = useCallback(
    () =>
      Promise.all([client.call('node:list'), client.call('graph:get')]).then(
        ([list, graphData]) => {
          setNodes(list);
          setGraph(graphData);
        },
        reportError,
      ),
    [client, reportError],
  );
  const refreshTags = useCallback(
    () => client.call('tag:list').then(setTags, reportError),
    [client, reportError],
  );

  useEffect(() => {
    void refreshNodes();
    void refreshTags();
  }, [refreshNodes, refreshTags]);

  // Seule la réponse à la dernière demande est prise en compte.
  const detailRequest = useRef(0);
  const selectedRef = useRef(selectedId);
  useLayoutEffect(() => {
    selectedRef.current = selectedId;
  });

  const loadDetail = useCallback(
    (id: string | null) => {
      const request = ++detailRequest.current;
      // Sans sélection, la fiche affichée est déjà vide (voir `detail` plus bas).
      if (!id) return;
      client.call('node:get', { id }).then(
        (loaded) => {
          if (request === detailRequest.current) setDetail(loaded);
        },
        (error: unknown) => {
          if (request !== detailRequest.current) return;
          setDetail(null);
          reportError(error);
        },
      );
    },
    [client, reportError],
  );

  const refreshDetail = useCallback(
    () => loadDetail(selectedRef.current),
    [loadDetail],
  );

  // La fiche suit la sélection : chargée par IPC (système externe).
  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  /** Recharge tout ce qui est affiché après une écriture externe. */
  const applyExternalChange = useRef(() => {});
  useLayoutEffect(() => {
    applyExternalChange.current = () => {
      setExternalRevision((revision) => revision + 1);
      setRelationsRevision((revision) => revision + 1);
      void refreshNodes();
      void refreshTags();
      refreshDetail();
      reportInfo('Espace mis à jour par l’assistant IA.');
    };
  });

  // Écritures d'un assistant IA (serveur MCP) : on recharge ce qui est
  // affiché, mais jamais pendant une saisie non enregistrée — le rechargement
  // attend qu'elle soit écrite, pour ne rien perdre.
  useEffect(() => {
    let waiting = false;
    const apply = () => {
      waiting = tracker.hasUnsavedChanges();
      if (!waiting) applyExternalChange.current();
    };
    const offChange = client.onExternalChange(apply);
    const offTracker = tracker.subscribe(() => {
      if (waiting) apply();
    });
    return () => {
      offChange();
      offTracker();
    };
  }, [client, tracker]);

  /** Positions déjà enregistrées : mise à jour locale, sans recharger. */
  const positionsSaved = useCallback((positions: NodePosition[]) => {
    const byId = new Map(positions.map((position) => [position.id, position]));
    setGraph(
      (current) =>
        current && {
          ...current,
          nodes: current.nodes.map((node) => {
            const position = byId.get(node.id);
            // Les trois coordonnées : un z manquant ferait replacer le nœud.
            return position
              ? { ...node, x: position.x, y: position.y, z: position.z }
              : node;
          }),
        },
    );
  }, []);

  const bumpRelations = useCallback(
    () => setRelationsRevision((revision) => revision + 1),
    [],
  );

  return {
    nodes,
    tags,
    graph,
    // La fiche affichée doit correspondre au nœud sélectionné.
    detail: detail?.id === selectedId ? detail : null,
    relationsRevision,
    externalRevision,
    refreshNodes,
    refreshTags,
    refreshDetail,
    bumpRelations,
    positionsSaved,
  };
}

export type WorkspaceData = ReturnType<typeof useWorkspaceData>;
