import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import type { DocumentSummary, RelationTypeInfo } from '../../../shared/model';
import type { VisibleGraph } from './graph-model';
import { GraphScene, type GraphSceneCallbacks } from './graph-scene';

export interface Graph3DViewHandle {
  fit(): void;
  zoom(factor: number): void;
  relayout(): void;
}

export interface Graph3DViewProps extends GraphSceneCallbacks {
  ref?: Ref<Graph3DViewHandle>;
  visible: VisibleGraph;
  relationTypes: readonly RelationTypeInfo[];
  selectedId: string | null;
  /** Documents du nœud sélectionné, affichés en cartes à côté de lui. */
  selectedDocuments: readonly DocumentSummary[] | null;
  /** Nœuds trouvés par la recherche ; `null` sans recherche active. */
  searchMatches: ReadonlySet<string> | null;
  /** Sélection multiple (Ctrl+clic, Ctrl+A). */
  multiSelection: ReadonlySet<string>;
}

/** Enveloppe React de la scène 3D ; toutes les données viennent des props. */
export function Graph3DView({
  ref,
  visible,
  relationTypes,
  selectedId,
  selectedDocuments,
  searchMatches,
  multiSelection,
  ...handlers
}: Graph3DViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // La scène appelle toujours les derniers callbacks reçus.
  const callbacks = useRef<GraphSceneCallbacks>(handlers);
  const latest = useRef({ selectedId, selectedDocuments });
  useEffect(() => {
    callbacks.current = handlers;
    latest.current = { selectedId, selectedDocuments };
  });

  useEffect(() => {
    if (!container.current) return;
    let scene: GraphScene;
    try {
      scene = new GraphScene(container.current, {
        onSelect: (id) => callbacks.current.onSelect(id),
        onOpen: (id) => callbacks.current.onOpen(id),
        onLink: (source, target) => callbacks.current.onLink(source, target),
        onPositionsChanged: (positions) =>
          callbacks.current.onPositionsChanged(positions),
        onOpenDocument: (id) => callbacks.current.onOpenDocument(id),
        onAddDocument: (nodeId) => callbacks.current.onAddDocument(nodeId),
        onToggleSelect: (id) => callbacks.current.onToggleSelect(id),
        onCreateAt: (position) => callbacks.current.onCreateAt(position),
      });
    } catch (error) {
      console.error('[graph] rendu 3D indisponible', error);
      // Signalé une seule fois, à l'initialisation (WebGL absent).
      // oxlint-disable-next-line react/set-state-in-effect
      setUnavailable(true);
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setData(visible, relationTypes);
    // Les cartes suivent le nœud sélectionné (recréées s'il réapparaît).
    scene.setDocuments(
      latest.current.selectedId,
      latest.current.selectedDocuments ?? [],
    );
  }, [visible, relationTypes]);

  useEffect(() => {
    sceneRef.current?.setSelection(selectedId);
  }, [selectedId]);

  useEffect(() => {
    sceneRef.current?.setDocuments(selectedId, selectedDocuments ?? []);
  }, [selectedId, selectedDocuments]);

  useEffect(() => {
    sceneRef.current?.setSearchMatches(searchMatches);
  }, [searchMatches]);

  useEffect(() => {
    sceneRef.current?.setMultiSelection(multiSelection);
  }, [multiSelection]);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => sceneRef.current?.fit(),
      zoom: (factor) => sceneRef.current?.zoom(factor),
      relayout: () => sceneRef.current?.relayout(),
    }),
    [],
  );

  if (unavailable) {
    return (
      <p className="muted empty-state">
        Le rendu 3D n’est pas disponible sur ce poste (WebGL désactivé).
        Utilisez l’arborescence et la vue Documents.
      </p>
    );
  }
  return (
    <div
      ref={container}
      className="graph-canvas"
      role="img"
      aria-label="Graphe 3D des nœuds et de leurs relations. Utilisez l’arborescence et le panneau Relations pour une navigation au clavier."
    />
  );
}
