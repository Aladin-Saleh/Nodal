import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import type { NodePosition, RelationTypeInfo } from '../../../shared/model';
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
}

/** Enveloppe React de la scène 3D ; toutes les données viennent des props. */
export function Graph3DView({
  ref,
  visible,
  relationTypes,
  selectedId,
  onSelect,
  onOpen,
  onLink,
  onPositionsChanged,
}: Graph3DViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  // La scène appelle toujours les derniers callbacks reçus.
  const callbacks = useRef<GraphSceneCallbacks>({
    onSelect,
    onOpen,
    onLink,
    onPositionsChanged,
  });
  useEffect(() => {
    callbacks.current = { onSelect, onOpen, onLink, onPositionsChanged };
  });

  useEffect(() => {
    if (!container.current) return;
    let scene: GraphScene;
    try {
      scene = new GraphScene(container.current, {
        onSelect: (id) => callbacks.current.onSelect(id),
        onOpen: (id) => callbacks.current.onOpen(id),
        onLink: (source, target) => callbacks.current.onLink(source, target),
        onPositionsChanged: (positions: NodePosition[]) =>
          callbacks.current.onPositionsChanged(positions),
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
    sceneRef.current?.setData(visible, relationTypes);
  }, [visible, relationTypes]);

  useEffect(() => {
    sceneRef.current?.setSelection(selectedId);
  }, [selectedId]);

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
