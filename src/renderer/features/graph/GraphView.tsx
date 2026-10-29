import cytoscape from 'cytoscape';
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { NodePosition } from '../../../shared/model';
import type { ElementDefinition } from './graph-model';
import { buildGraphStyle } from './graph-style';

export interface GraphViewHandle {
  fit(): void;
  zoom(factor: number): void;
  /** Disposition automatique des éléments affichés ; retourne les positions. */
  runLayout(): Promise<NodePosition[]>;
}

export interface GraphViewProps {
  ref?: Ref<GraphViewHandle>;
  elements: ElementDefinition[];
  selectedId: string | null;
  /** Nœud source en mode « relier » : le prochain clic choisit la cible. */
  linkSourceId: string | null;
  onSelect(id: string | null): void;
  onOpen(id: string): void;
  onLinkTarget(id: string): void;
  onPositionsChanged(positions: NodePosition[]): void;
}

/** Zoom maximal après un recadrage automatique. */
const MAX_FIT_ZOOM = 1.25;

const LAYOUT_OPTIONS = {
  name: 'cose',
  animate: false,
  randomize: true,
  padding: 40,
  nodeDimensionsIncludeLabels: true,
  nodeRepulsion: () => 9000,
  idealEdgeLength: () => 70,
  edgeElasticity: () => 80,
  nodeOverlap: 40,
  gravity: 1.2,
  componentSpacing: 60,
  numIter: 2000,
} as cytoscape.LayoutOptions;

/**
 * Rendu Cytoscape (§6.8) : zoom, déplacement de la vue, sélection,
 * déplacement des nœuds. Les données viennent entièrement des props.
 */
export function GraphView({
  ref,
  elements,
  selectedId,
  linkSourceId,
  onSelect,
  onOpen,
  onLinkTarget,
  onPositionsChanged,
}: GraphViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  // Les gestionnaires Cytoscape lisent toujours les derniers callbacks.
  const handlers = useRef({
    onSelect,
    onOpen,
    onLinkTarget,
    onPositionsChanged,
    linkSourceId,
    selectedId,
  });
  useEffect(() => {
    handlers.current = {
      onSelect,
      onOpen,
      onLinkTarget,
      onPositionsChanged,
      linkSourceId,
      selectedId,
    };
  });

  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      style: buildGraphStyle(),
      minZoom: 0.15,
      maxZoom: 3,
      boxSelectionEnabled: false,
      selectionType: 'single',
    });
    cyRef.current = cy;

    cy.on('tap', 'node', (event) => {
      const id = event.target.id() as string;
      const { linkSourceId: source } = handlers.current;
      if (source) {
        if (id !== source) handlers.current.onLinkTarget(id);
        return;
      }
      handlers.current.onSelect(id);
    });
    cy.on('tap', (event) => {
      if (event.target === cy) handlers.current.onSelect(null);
    });
    cy.on('dbltap', 'node', (event) =>
      handlers.current.onOpen(event.target.id()),
    );
    cy.on('dragfree', 'node', (event) => {
      const node = event.target as cytoscape.NodeSingular;
      const { x, y } = node.position();
      handlers.current.onPositionsChanged([
        { id: node.id(), x: Math.round(x), y: Math.round(y) },
      ]);
    });

    // Thème clair / sombre : la feuille de style suit les variables CSS.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const restyle = () => cy.style(buildGraphStyle());
    media.addEventListener('change', restyle);

    // La zone peut changer de taille (barre d'outils sur deux lignes, fenêtre).
    const observer = new ResizeObserver(() => cy.resize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', restyle);
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Synchronisation des éléments : ajout, retrait et mise à jour sans tout recréer.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const wasEmpty = cy.elements().empty();
    const wanted = new Map(
      elements.map((element) => [element.data.id, element]),
    );
    cy.batch(() => {
      cy.elements().forEach((element) => {
        if (!wanted.has(element.id())) element.remove();
      });
      for (const definition of elements) {
        const existing = cy.getElementById(definition.data.id);
        if (existing.empty()) {
          cy.add(definition as cytoscape.ElementDefinition);
          continue;
        }
        existing.data(definition.data);
        existing.classes(definition.classes ?? '');
        if (definition.position && existing.isNode() && !existing.grabbed()) {
          const current = existing.position();
          if (
            current.x !== definition.position.x ||
            current.y !== definition.position.y
          ) {
            existing.position(definition.position);
          }
        }
      }
    });
    if (wasEmpty && elements.length > 0) fitView(cy);
    // `classes()` a réinitialisé les classes de mise en évidence.
    applyHighlight(
      cy,
      handlers.current.selectedId,
      handlers.current.linkSourceId,
    );
  }, [elements]);

  // Sélection, voisinage direct et nœud source d'une liaison.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyHighlight(cy, selectedId, linkSourceId);
    revealSelection(cy, selectedId);
    if (container.current) {
      container.current.style.cursor = linkSourceId ? 'crosshair' : '';
    }
  }, [selectedId, linkSourceId]);

  useImperativeHandle(
    ref,
    () => ({
      fit() {
        if (cyRef.current) fitView(cyRef.current);
      },
      zoom(factor) {
        const cy = cyRef.current;
        if (!cy) return;
        cy.zoom({
          level: cy.zoom() * factor,
          renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
        });
      },
      runLayout() {
        const cy = cyRef.current;
        if (!cy || cy.nodes().empty()) return Promise.resolve([]);
        return new Promise((resolve) => {
          const layout = cy.elements().layout(LAYOUT_OPTIONS);
          layout.one('layoutstop', () => {
            fitView(cy);
            resolve(
              cy.nodes().map((node) => ({
                id: node.id(),
                x: Math.round(node.position().x),
                y: Math.round(node.position().y),
              })),
            );
          });
          layout.run();
        });
      },
    }),
    [],
  );

  return (
    <div
      ref={container}
      className="graph-canvas"
      role="img"
      aria-label="Graphe des nœuds et de leurs relations. Utilisez l’arborescence et le panneau Relations pour une navigation au clavier."
    />
  );
}

function applyHighlight(
  cy: cytoscape.Core,
  selectedId: string | null,
  linkSourceId: string | null,
): void {
  cy.batch(() => {
    cy.elements().unselect().removeClass('faded link-source');
    if (linkSourceId) cy.getElementById(linkSourceId).addClass('link-source');
    if (!selectedId) return;
    const node = cy.getElementById(selectedId);
    if (node.empty()) return;
    node.select();
    cy.elements().not(node.closedNeighborhood()).addClass('faded');
  });
}

/** Cadre tout le graphe, sans agrandir excessivement un petit graphe. */
function fitView(cy: cytoscape.Core): void {
  cy.resize();
  // Marge élargie : la légende occupe le bas de la zone.
  cy.fit(undefined, 64);
  if (cy.zoom() > MAX_FIT_ZOOM) {
    cy.zoom(MAX_FIT_ZOOM);
    cy.center();
  }
}

/** Ramène le nœud sélectionné dans la vue s'il en est sorti. */
function revealSelection(cy: cytoscape.Core, selectedId: string | null): void {
  if (!selectedId) return;
  const node = cy.getElementById(selectedId);
  if (node.empty()) return;
  const box = node.renderedBoundingBox();
  const outside =
    box.x1 < 0 || box.y1 < 0 || box.x2 > cy.width() || box.y2 > cy.height();
  if (outside) cy.animate({ center: { eles: node }, duration: 250 });
}
