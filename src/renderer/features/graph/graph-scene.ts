/**
 * Scène 3D du graphe (three.js + d3-force-3d), indépendante de React.
 *
 * Interactions :
 * - glisser dans le vide : rotation ; clic droit glissé : déplacement de la
 *   vue ; molette : zoom ;
 * - glisser depuis un nœud vers un autre : création d'une relation ;
 * - Maj + glisser un nœud : déplacement (position enregistrée) ;
 * - clic : sélection ; double-clic : ouverture de la fiche.
 */
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type LinkForce,
  type Simulation,
  type SimulationNode,
} from 'd3-force-3d';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { NodeType } from '../../../shared/domain';
import type {
  DocumentSummary,
  GraphNode,
  NodePosition,
  RelationTypeInfo,
} from '../../../shared/model';
import { hasPosition, seedPositions, type VisibleGraph } from './graph-model';
import {
  createDocumentPage,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  createLabel,
  createNodeGeometry,
  disposeObject,
  NODE_RADIUS,
  readTheme,
  type GraphTheme,
} from './node-visuals';

export interface GraphSceneCallbacks {
  onSelect(id: string | null): void;
  onOpen(id: string): void;
  onLink(sourceId: string, targetId: string): void;
  onPositionsChanged(positions: NodePosition[]): void;
  /** Clic sur la carte d'un document du nœud sélectionné. */
  onOpenDocument(documentId: string): void;
  /** Clic sur la carte « + Document » du nœud sélectionné. */
  onAddDocument(nodeId: string): void;
  /** Ctrl+clic sur un nœud : l'ajoute ou le retire de la sélection multiple. */
  onToggleSelect(id: string): void;
  /** Double-clic dans le vide : créer un nœud à cet endroit. */
  onCreateAt(position: { x: number; y: number; z: number }): void;
}

type CardTarget =
  | { kind: 'document'; id: string }
  | { kind: 'add-document'; nodeId: string };

interface DocumentCard {
  target: CardTarget;
  object: THREE.Group;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

interface SimNode extends SimulationNode {
  id: string;
}

interface SimLink {
  id: string;
  source: string | SimNode;
  target: string | SimNode;
  kind: 'relation' | 'hierarchy';
}

interface NodeEntry {
  data: GraphNode;
  sim: SimNode;
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  /** Étiquette créée à la demande (voir LABEL_LIMIT). */
  label: THREE.Sprite | null;
  labelKey: string;
}

interface LinkEntry {
  link: SimLink;
  sourceId: string;
  targetId: string;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  arrow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null;
  label: THREE.Sprite | null;
  labelKey: string;
}

type PointerMode =
  | { kind: 'idle' }
  | { kind: 'orbit'; startX: number; startY: number }
  | { kind: 'card'; target: CardTarget; startX: number; startY: number }
  | {
      kind: 'link' | 'move';
      nodeId: string;
      startX: number;
      startY: number;
      moved: boolean;
      plane: THREE.Plane;
    };

/** Au-delà, les libellés des relations ne s'affichent qu'autour de la sélection. */
const EDGE_LABEL_LIMIT = 120;
/**
 * Au-delà, seules les étiquettes utiles (sélection, voisins, survol,
 * recherche, sélection multiple) sont créées : chaque étiquette est une
 * texture, et des milliers satureraient la mémoire graphique.
 */
const LABEL_LIMIT = 250;
const CLICK_TOLERANCE_PX = 5;
const FADED_OPACITY = 0.15;
const LABEL_OFFSET = NODE_RADIUS + 3;
/** Hauteur des étiquettes en fraction de la hauteur de la vue. */
const NODE_LABEL_HEIGHT = 0.036;
const EDGE_LABEL_HEIGHT = 0.026;
/** Cartes des documents : hauteur (fraction de la vue) et espacement. */
const CARD_LABEL_HEIGHT = 0.03;
/** Distance de la caméra après un zoom sur un nœud. */
const FOCUS_DISTANCE = NODE_RADIUS * 17;
const FLIGHT_MS = 450;

function round(value: number | undefined): number {
  return Math.round((value ?? 0) * 10) / 10;
}

export class GraphScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly nodesGroup = new THREE.Group();
  private readonly linksGroup = new THREE.Group();
  private readonly simulation: Simulation<SimNode>;
  private readonly nodes = new Map<string, NodeEntry>();
  private readonly links = new Map<string, LinkEntry>();
  private readonly observer: ResizeObserver;
  private readonly media = window.matchMedia('(prefers-color-scheme: dark)');
  private theme: GraphTheme = readTheme();
  private relationTypes = new Map<string, RelationTypeInfo>();
  private selectedId: string | null = null;
  private searchMatches: ReadonlySet<string> | null = null;
  private readonly cardsGroup = new THREE.Group();
  private cards: { nodeId: string; items: DocumentCard[] } | null = null;
  private multiSelection: ReadonlySet<string> = new Set();
  private flight: {
    fromPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toPosition: THREE.Vector3;
    toTarget: THREE.Vector3;
    start: number;
  } | null = null;
  private hoveredId: string | null = null;
  private linkTargetId: string | null = null;
  private pointer: PointerMode = { kind: 'idle' };
  private tempLine: THREE.Line | null = null;
  private dirty = true;
  private fitPending = true;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: GraphSceneCallbacks,
  ) {
    // Lève une exception si WebGL est indisponible : géré par l'appelant.
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'graph-webgl';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
    this.camera.position.set(0, 60, 320);
    // La lumière suit la caméra : les faces visibles restent éclairées.
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(60, 120, 80);
    this.camera.add(light);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.4));
    this.scene.add(this.nodesGroup, this.linksGroup, this.cardsGroup);
    this.applyThemeToScene();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.addEventListener('change', this.markDirty);

    const linkForce = forceLink<SimNode, SimLink>([])
      .id((node) => node.id)
      .distance((link) => (link.kind === 'hierarchy' ? 45 : 70))
      .strength((link) => (link.kind === 'hierarchy' ? 0.3 : 0.7));
    this.simulation = forceSimulation<SimNode>([], 3)
      .alphaDecay(0.03)
      .velocityDecay(0.35)
      .force('charge', forceManyBody<SimNode>().strength(-140).distanceMax(400))
      .force('link', linkForce)
      .on('tick', this.onTick)
      .on('end', this.onSimulationEnd)
      .stop();

    const canvas = this.renderer.domElement;
    // Phase de capture : décider avant OrbitControls si le glisser lui revient.
    canvas.addEventListener('pointerdown', this.onPointerDown, {
      capture: true,
    });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.media.addEventListener('change', this.onThemeChange);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(this.loop);
  }

  // --- API publique -----------------------------------------------------

  setData(
    visible: VisibleGraph,
    relationTypes: readonly RelationTypeInfo[],
  ): void {
    this.relationTypes = new Map(relationTypes.map((type) => [type.id, type]));
    const seeds = new Map(
      seedPositions(visible).map((seed) => [seed.id, seed]),
    );
    const wanted = new Set(visible.nodes.map((node) => node.id));

    for (const [id, entry] of this.nodes) {
      if (!wanted.has(id)) {
        this.nodesGroup.remove(entry.group);
        disposeObject(entry.group);
        this.nodes.delete(id);
      }
    }
    if (this.cards && !wanted.has(this.cards.nodeId)) this.clearCards();

    let hasFree = false;
    for (const data of visible.nodes) {
      let entry = this.nodes.get(data.id);
      const isNew = !entry;
      if (!entry) {
        entry = this.createNode(data);
        this.nodes.set(data.id, entry);
      } else {
        this.updateNode(entry, data);
      }
      const dragging =
        this.pointer.kind === 'move' && this.pointer.nodeId === data.id;
      if (hasPosition(data)) {
        if (!dragging) this.fixAt(entry.sim, data.x, data.y, data.z);
        continue;
      }
      if (isNew) {
        // Nouveau dans la scène : position de départ près de ses voisins.
        const seed = seeds.get(data.id);
        if (seed) {
          entry.sim.x = seed.x;
          entry.sim.y = seed.y;
          entry.sim.z = seed.z;
        }
        hasFree = true;
      } else if (entry.sim.fx == null) {
        // Déjà en cours de placement par la simulation.
        hasFree = true;
      }
      // Sinon : position déjà calculée dans la scène mais pas encore
      // enregistrée (rechargement arrivé avant l'écriture) ; on la garde.
    }

    const linkSpecs: SimLink[] = [
      ...visible.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceId,
        target: edge.targetId,
        kind: 'relation' as const,
        label: edge.label,
        relationTypeId: edge.relationTypeId,
      })),
      ...visible.hierarchy.map((link) => ({
        id: link.id,
        source: link.parentId,
        target: link.childId,
        kind: 'hierarchy' as const,
      })),
    ];
    this.syncLinks(visible, linkSpecs);

    const simNodes = [...this.nodes.values()].map((entry) => entry.sim);
    const allFree = simNodes.every((node) => node.fx == null);
    this.simulation.force(
      'center',
      allFree ? forceCenter<SimNode>(0, 0, 0) : null,
    );
    this.simulation.nodes(simNodes);
    (this.simulation.force('link') as LinkForce<SimNode, SimLink>).links(
      [...this.links.values()].map((entry) => entry.link),
    );
    if (hasFree) {
      this.simulation.alpha(allFree ? 1 : 0.5).restart();
    } else if (this.fitPending && simNodes.length > 0) {
      this.updatePositions();
      this.fit();
    }
    this.updatePositions();
    this.applyHighlight();
  }

  setSelection(id: string | null): void {
    this.selectedId = id;
    this.applyHighlight();
    if (id) this.flyTo(id);
  }

  /** Sélection multiple (Ctrl+clic, Ctrl+A), mise en évidence. */
  setMultiSelection(ids: ReadonlySet<string>): void {
    this.multiSelection = ids;
    this.applyHighlight();
  }

  /** Nœuds trouvés par la recherche, mis en évidence ; `null` sans recherche. */
  setSearchMatches(matches: ReadonlySet<string> | null): void {
    this.searchMatches = matches;
    this.applyHighlight();
  }

  /**
   * Documents du nœud sélectionné, affichés en « pages » 3D à côté de lui
   * (uniquement pour ce nœud, pour ne pas surcharger le graphe).
   */
  setDocuments(
    nodeId: string | null,
    documents: readonly DocumentSummary[],
  ): void {
    this.clearCards();
    if (!nodeId || !this.nodes.has(nodeId)) return;
    const colors = this.labelColors();
    const targets: { target: CardTarget; object: THREE.Group }[] =
      documents.map((doc) => ({
        target: { kind: 'document', id: doc.id },
        object: createDocumentPage(doc.title, doc.contentType, doc.language, {
          labelHeight: CARD_LABEL_HEIGHT,
          ...colors,
        }),
      }));
    targets.push({
      target: { kind: 'add-document', nodeId },
      object: createDocumentPage('Nouveau document', 'add', null, {
        labelHeight: CARD_LABEL_HEIGHT,
        ...colors,
      }),
    });
    const items: DocumentCard[] = targets.map(({ target, object }) => {
      object.traverse((child) => {
        child.userData.card = target;
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(6), 3),
      );
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: this.theme.accent,
          transparent: true,
          opacity: 0.5,
        }),
      );
      line.frustumCulled = false;
      this.cardsGroup.add(line, object);
      return { target, object, line };
    });
    this.cards = { nodeId, items };
    this.layoutCards();
    this.markDirty();
  }

  private clearCards(): void {
    if (!this.cards) return;
    for (const { object, line } of this.cards.items) {
      this.cardsGroup.remove(object, line);
      disposeObject(object);
      disposeObject(line);
    }
    this.cards = null;
    this.markDirty();
  }

  /**
   * Place les pages en colonne à droite du nœud, face à la caméra (elles
   * pivotent avec la vue pour rester lisibles).
   */
  private layoutCards(): void {
    if (!this.cards) return;
    const center = this.position(this.cards.nodeId);
    if (!center) return;
    const right = new THREE.Vector3().setFromMatrixColumn(
      this.camera.matrixWorld,
      0,
    );
    const up = new THREE.Vector3().setFromMatrixColumn(
      this.camera.matrixWorld,
      1,
    );
    const start = center.clone().addScaledVector(right, NODE_RADIUS * 1.2);
    const columnX = NODE_RADIUS * 2.4 + PAGE_WIDTH / 2;
    const spacing = PAGE_HEIGHT * 1.3;
    const count = this.cards.items.length;
    this.cards.items.forEach(({ object, line }, index) => {
      const offset = ((count - 1) / 2 - index) * spacing;
      const anchor = center
        .clone()
        .addScaledVector(right, columnX)
        .addScaledVector(up, offset);
      object.position.copy(anchor);
      object.quaternion.copy(this.camera.quaternion);
      const end = anchor.clone().addScaledVector(right, -PAGE_WIDTH / 2);
      const attribute = line.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      attribute.setXYZ(0, start.x, start.y, start.z);
      attribute.setXYZ(1, end.x, end.y, end.z);
      attribute.needsUpdate = true;
    });
  }

  /** Zoom animé sur un nœud (et ses documents, affichés à sa droite). */
  private flyTo(id: string): void {
    const center = this.position(id);
    if (!center) return;
    const right = new THREE.Vector3().setFromMatrixColumn(
      this.camera.matrixWorld,
      0,
    );
    const target = center.clone().addScaledVector(right, NODE_RADIUS * 2.5);
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    this.flight = {
      fromPosition: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPosition: target.clone().addScaledVector(direction, FOCUS_DISTANCE),
      toTarget: target,
      start: performance.now(),
    };
    this.markDirty();
  }

  private advanceFlight(): void {
    const flight = this.flight;
    if (!flight) return;
    const t = Math.min((performance.now() - flight.start) / FLIGHT_MS, 1);
    // Accélération puis décélération douces.
    const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    this.camera.position.lerpVectors(
      flight.fromPosition,
      flight.toPosition,
      eased,
    );
    this.controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
    if (t >= 1) this.flight = null;
    this.dirty = true;
  }

  /** Cadre tout le graphe affiché. */
  fit(): void {
    const points = [...this.nodes.values()].map(
      ({ sim }) => new THREE.Vector3(sim.x ?? 0, sim.y ?? 0, sim.z ?? 0),
    );
    if (points.length === 0) return;
    this.fitPending = false;
    const box = new THREE.Box3().setFromPoints(points);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(
      Math.max(...points.map((point) => point.distanceTo(center))) +
        NODE_RADIUS * 2,
      40,
    );
    // Le champ le plus étroit (vertical ou horizontal) contraint le cadrage.
    const halfVertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const halfHorizontal = Math.atan(
      Math.tan(halfVertical) * this.camera.aspect,
    );
    const distance =
      (radius / Math.sin(Math.min(halfVertical, halfHorizontal))) * 0.95;
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    if (direction.lengthSq() === 0) direction.set(0, 0.2, 1).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.camera.near = Math.max(distance / 200, 0.5);
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    const fog = this.scene.fog as THREE.Fog;
    // Brouillard léger : indice de profondeur sans masquer le fond du graphe.
    fog.near = distance;
    fog.far = distance + radius * 6;
    this.markDirty();
  }

  zoom(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.camera.position
      .copy(this.controls.target)
      .addScaledVector(offset, 1 / factor);
    this.markDirty();
  }

  /** Disposition automatique complète ; les positions sont enregistrées à la fin. */
  relayout(): void {
    const simNodes = [...this.nodes.values()].map((entry) => entry.sim);
    for (const node of simNodes) {
      node.fx = node.fy = node.fz = null;
      node.x = node.y = node.z = Number.NaN;
      node.vx = node.vy = node.vz = 0;
    }
    this.fitPending = true;
    this.simulation.force('center', forceCenter<SimNode>(0, 0, 0));
    // Réinitialise les positions de départ (répartition régulière).
    this.simulation.nodes(simNodes);
    this.simulation.alpha(1).restart();
  }

  dispose(): void {
    // Enregistrer les positions encore en cours de calcul : sinon, quitter la
    // vue avant la fin de la simulation relancerait la disposition au retour.
    const unsettled: NodePosition[] = [];
    for (const { sim } of this.nodes.values()) {
      if (sim.fx != null || sim.x === undefined || Number.isNaN(sim.x))
        continue;
      unsettled.push({
        id: sim.id,
        x: round(sim.x),
        y: round(sim.y),
        z: round(sim.z),
      });
    }
    if (unsettled.length > 0) this.callbacks.onPositionsChanged(unsettled);
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.simulation.on('tick', null).on('end', null).stop();
    this.observer.disconnect();
    this.media.removeEventListener('change', this.onThemeChange);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown, {
      capture: true,
    });
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerUp);
    canvas.removeEventListener('dblclick', this.onDoubleClick);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    disposeObject(this.scene);
    this.renderer.dispose();
    canvas.remove();
  }

  // --- Construction des objets --------------------------------------------

  private nodeColor(data: GraphNode): string {
    return data.color ?? this.theme.typeColors[data.nodeType];
  }

  private labelColors(): { background: string; color: string } {
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(this.theme.background).getHSL(hsl);
    return hsl.l > 0.5
      ? { background: 'rgba(255, 255, 255, 0.92)', color: '#1d1e22' }
      : { background: 'rgba(16, 17, 20, 0.82)', color: '#f1f2f5' };
  }

  private createNode(data: GraphNode): NodeEntry {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      createNodeGeometry(data.nodeType),
      new THREE.MeshStandardMaterial({
        color: this.nodeColor(data),
        roughness: 0.45,
        metalness: 0.1,
        transparent: true,
      }),
    );
    mesh.userData.id = data.id;
    group.add(mesh);
    this.nodesGroup.add(group);
    return {
      data,
      sim: { id: data.id },
      group,
      mesh,
      label: null,
      labelKey: '',
    };
  }

  /** Crée ou retire l'étiquette d'un nœud selon qu'elle doit être visible. */
  private syncLabel(entry: NodeEntry, wanted: boolean): void {
    if (!wanted) {
      if (entry.label) {
        entry.group.remove(entry.label);
        disposeObject(entry.label);
        entry.label = null;
        entry.labelKey = '';
      }
      return;
    }
    if (entry.label && entry.labelKey === entry.data.title) return;
    this.replaceNodeLabel(entry, entry.data.title);
  }

  private updateNode(entry: NodeEntry, data: GraphNode): void {
    if (entry.data.nodeType !== data.nodeType) {
      entry.mesh.geometry.dispose();
      entry.mesh.geometry = createNodeGeometry(data.nodeType as NodeType);
    }
    entry.mesh.material.color.set(this.nodeColor(data));
    entry.data = data;
    if (entry.label && entry.labelKey !== data.title) {
      this.replaceNodeLabel(entry, data.title);
    }
  }

  private replaceNodeLabel(entry: NodeEntry, title: string): void {
    if (entry.label) {
      entry.group.remove(entry.label);
      disposeObject(entry.label);
    }
    entry.label = createLabel(title, {
      height: NODE_LABEL_HEIGHT,
      ...this.labelColors(),
    });
    entry.label.position.set(0, LABEL_OFFSET, 0);
    entry.label.userData.id = entry.data.id;
    entry.group.add(entry.label);
    entry.labelKey = title;
  }

  private syncLinks(
    visible: VisibleGraph,
    specs: (SimLink & { label?: string | null; relationTypeId?: string })[],
  ): void {
    const wanted = new Set(specs.map((spec) => spec.id));
    for (const [id, entry] of this.links) {
      if (!wanted.has(id)) this.removeLink(id, entry);
    }
    const showLabels = visible.edges.length <= EDGE_LABEL_LIMIT;
    for (const spec of specs) {
      const type = spec.relationTypeId
        ? this.relationTypes.get(spec.relationTypeId)
        : undefined;
      const text =
        spec.kind === 'relation' ? (spec.label ?? type?.name ?? '') : '';
      const color =
        spec.kind === 'hierarchy'
          ? this.theme.hierarchy
          : (type?.color ?? this.theme.edge);
      const labelKey = `${text}|${color}|${showLabels}`;
      const existing = this.links.get(spec.id);
      if (
        existing &&
        existing.labelKey === labelKey &&
        existing.sourceId === spec.source &&
        existing.targetId === spec.target
      ) {
        continue;
      }
      if (existing) this.removeLink(spec.id, existing);
      this.links.set(
        spec.id,
        this.createLink(spec, text, color, showLabels, labelKey),
      );
    }
  }

  private createLink(
    spec: SimLink,
    text: string,
    color: string,
    showLabel: boolean,
    labelKey: string,
  ): LinkEntry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(6), 3),
    );
    const material =
      spec.kind === 'hierarchy'
        ? new THREE.LineDashedMaterial({
            color,
            dashSize: 3,
            gapSize: 2.5,
            transparent: true,
          })
        : new THREE.LineBasicMaterial({ color, transparent: true });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    this.linksGroup.add(line);

    let arrow: LinkEntry['arrow'] = null;
    let label: THREE.Sprite | null = null;
    if (spec.kind === 'relation') {
      arrow = new THREE.Mesh(
        new THREE.ConeGeometry(2.4, 6, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      this.linksGroup.add(arrow);
      if (showLabel && text) {
        label = createLabel(text, {
          height: EDGE_LABEL_HEIGHT,
          ...this.labelColors(),
        });
        this.linksGroup.add(label);
      }
    }
    return {
      link: {
        id: spec.id,
        source: spec.source,
        target: spec.target,
        kind: spec.kind,
      },
      sourceId: spec.source as string,
      targetId: spec.target as string,
      line,
      arrow,
      label,
      labelKey,
    };
  }

  private removeLink(id: string, entry: LinkEntry): void {
    for (const object of [entry.line, entry.arrow, entry.label]) {
      if (!object) continue;
      this.linksGroup.remove(object);
      disposeObject(object);
    }
    this.links.delete(id);
  }

  // --- Simulation et positions ---------------------------------------------

  private fixAt(node: SimNode, x: number, y: number, z: number): void {
    node.x = node.fx = x;
    node.y = node.fy = y;
    node.z = node.fz = z;
  }

  private readonly onTick = () => {
    this.updatePositions();
  };

  private readonly onSimulationEnd = () => {
    if (this.disposed) return;
    const settled: NodePosition[] = [];
    for (const { sim } of this.nodes.values()) {
      if (sim.fx != null) continue;
      this.fixAt(sim, round(sim.x), round(sim.y), round(sim.z));
      settled.push({ id: sim.id, x: sim.fx!, y: sim.fy!, z: sim.fz! });
    }
    this.simulation.force('center', null);
    if (this.fitPending) this.fit();
    if (settled.length > 0) this.callbacks.onPositionsChanged(settled);
  };

  private position(id: string): THREE.Vector3 | null {
    const sim = this.nodes.get(id)?.sim;
    if (!sim || sim.x === undefined || Number.isNaN(sim.x)) return null;
    return new THREE.Vector3(sim.x, sim.y ?? 0, sim.z ?? 0);
  }

  private updatePositions(): void {
    for (const { sim, group } of this.nodes.values()) {
      if (sim.x === undefined || Number.isNaN(sim.x)) continue;
      group.position.set(sim.x, sim.y ?? 0, sim.z ?? 0);
    }
    const up = new THREE.Vector3(0, 1, 0);
    for (const entry of this.links.values()) {
      const from = this.position(entry.sourceId);
      const to = this.position(entry.targetId);
      if (!from || !to) continue;
      const direction = to.clone().sub(from);
      const length = direction.length();
      if (length < 0.001) continue;
      direction.divideScalar(length);
      const start = from.clone().addScaledVector(direction, NODE_RADIUS);
      const end = to
        .clone()
        .addScaledVector(direction, -NODE_RADIUS - (entry.arrow ? 4 : 0));
      const attribute = entry.line.geometry.getAttribute(
        'position',
      ) as THREE.BufferAttribute;
      attribute.setXYZ(0, start.x, start.y, start.z);
      attribute.setXYZ(1, end.x, end.y, end.z);
      attribute.needsUpdate = true;
      if (entry.line.material instanceof THREE.LineDashedMaterial) {
        entry.line.computeLineDistances();
      }
      if (entry.arrow) {
        entry.arrow.position.copy(end).addScaledVector(direction, 1.5);
        entry.arrow.quaternion.setFromUnitVectors(up, direction);
      }
      entry.label?.position.copy(from).add(to).multiplyScalar(0.5);
    }
    this.markDirty();
  }

  // --- Mise en évidence ----------------------------------------------------

  private applyHighlight(): void {
    const focus =
      this.selectedId && this.nodes.has(this.selectedId)
        ? this.selectedId
        : null;
    const close = new Set<string>();
    if (focus) {
      close.add(focus);
      for (const entry of this.links.values()) {
        if (entry.sourceId === focus) close.add(entry.targetId);
        if (entry.targetId === focus) close.add(entry.sourceId);
      }
    }
    const matches = this.searchMatches;
    // Avec une recherche active, seuls les nœuds trouvés restent nets (§6.9).
    const shown = (id: string) =>
      id === focus ||
      this.multiSelection.has(id) ||
      ((!focus || close.has(id)) && (!matches || matches.has(id)));
    const accent = new THREE.Color(this.theme.accent);
    const black = new THREE.Color(0x000000);
    for (const [id, entry] of this.nodes) {
      const visible = shown(id);
      const opacity = visible ? 1 : FADED_OPACITY;
      entry.mesh.material.opacity = opacity;
      entry.mesh.material.depthWrite = visible;
      const labelled =
        this.nodes.size <= LABEL_LIMIT ||
        id === focus ||
        (!!focus && close.has(id)) ||
        id === this.hoveredId ||
        id === this.linkTargetId ||
        !!matches?.has(id) ||
        this.multiSelection.has(id);
      this.syncLabel(entry, labelled);
      if (entry.label) entry.label.material.opacity = opacity;
      const matched = !!matches?.has(id) || this.multiSelection.has(id);
      const emphasized = id === focus || id === this.linkTargetId || matched;
      entry.mesh.material.emissive.copy(emphasized ? accent : black);
      entry.mesh.material.emissiveIntensity =
        id === focus || id === this.linkTargetId ? 0.55 : matched ? 0.4 : 0;
      const scale =
        id === focus
          ? 1.3
          : matched
            ? 1.2
            : id === this.hoveredId || id === this.linkTargetId
              ? 1.15
              : 1;
      entry.mesh.scale.setScalar(scale);
    }
    const crowded = this.links.size > EDGE_LABEL_LIMIT;
    for (const entry of this.links.values()) {
      const touches =
        !!focus && (entry.sourceId === focus || entry.targetId === focus);
      const opacity =
        touches || (!focus && shown(entry.sourceId) && shown(entry.targetId))
          ? 1
          : FADED_OPACITY;
      entry.line.material.opacity = opacity;
      if (entry.arrow) entry.arrow.material.opacity = opacity;
      if (entry.label) {
        entry.label.material.opacity = opacity;
        entry.label.visible = !crowded || touches;
      }
    }
    this.markDirty();
  }

  // --- Interactions --------------------------------------------------------

  private hit(
    event: PointerEvent | MouseEvent,
    exclude?: string,
  ): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const [id, entry] of this.nodes) {
      if (id === exclude) continue;
      targets.push(entry.mesh);
      if (entry.label) targets.push(entry.label);
    }
    const [first] = this.raycaster.intersectObjects(targets, false);
    return (first?.object.userData.id as string | undefined) ?? null;
  }

  /** Carte de document sous le pointeur, prioritaire sur les nœuds. */
  private hitCard(event: PointerEvent | MouseEvent): CardTarget | null {
    if (!this.cards) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    const [first] = this.raycaster.intersectObjects(
      this.cards.items.map((item) => item.object),
      true,
    );
    return (first?.object.userData.card as CardTarget | undefined) ?? null;
  }

  private planeThrough(id: string): THREE.Plane {
    const normal = this.camera.getWorldDirection(new THREE.Vector3());
    return new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      this.position(id) ?? new THREE.Vector3(),
    );
  }

  private pointOnPlane(
    event: PointerEvent,
    plane: THREE.Plane,
  ): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    // Toute interaction de la souris interrompt un zoom animé en cours.
    this.flight = null;
    if (event.button !== 0) return;
    const card = this.hitCard(event);
    if (card) {
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.pointer = {
        kind: 'card',
        target: card,
        startX: event.clientX,
        startY: event.clientY,
      };
      return;
    }
    const id = this.hit(event);
    if (!id) {
      this.pointer = {
        kind: 'orbit',
        startX: event.clientX,
        startY: event.clientY,
      };
      return;
    }
    // Le glisser depuis un nœud ne fait pas tourner la vue.
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.pointer = {
      kind: event.shiftKey ? 'move' : 'link',
      nodeId: id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      plane: this.planeThrough(id),
    };
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    const pointer = this.pointer;
    const canvas = this.renderer.domElement;
    if (pointer.kind === 'idle') {
      if (this.hitCard(event)) {
        canvas.style.cursor = 'pointer';
        return;
      }
      const id = this.hit(event);
      if (id !== this.hoveredId) {
        this.hoveredId = id;
        this.applyHighlight();
      }
      canvas.style.cursor = id
        ? event.shiftKey
          ? 'move'
          : 'crosshair'
        : 'grab';
      return;
    }
    if (pointer.kind === 'orbit' || pointer.kind === 'card') return;

    if (
      !pointer.moved &&
      Math.hypot(
        event.clientX - pointer.startX,
        event.clientY - pointer.startY,
      ) > CLICK_TOLERANCE_PX
    ) {
      pointer.moved = true;
    }
    if (!pointer.moved) return;
    const point = this.pointOnPlane(event, pointer.plane);
    if (!point) return;

    if (pointer.kind === 'move') {
      const sim = this.nodes.get(pointer.nodeId)?.sim;
      if (sim) this.fixAt(sim, point.x, point.y, point.z);
      this.updatePositions();
      return;
    }

    // Relier : trait provisoire du nœud source jusqu'au pointeur.
    const from = this.position(pointer.nodeId);
    if (!from) return;
    const target = this.hit(event, pointer.nodeId);
    const end = (target && this.position(target)) || point;
    if (!this.tempLine) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(6), 3),
      );
      this.tempLine = new THREE.Line(
        geometry,
        new THREE.LineDashedMaterial({
          color: this.theme.accent,
          dashSize: 3,
          gapSize: 2,
          depthTest: false,
        }),
      );
      this.tempLine.frustumCulled = false;
      this.tempLine.renderOrder = 10;
      this.scene.add(this.tempLine);
    }
    const attribute = this.tempLine.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    attribute.setXYZ(0, from.x, from.y, from.z);
    attribute.setXYZ(1, end.x, end.y, end.z);
    attribute.needsUpdate = true;
    this.tempLine.computeLineDistances();
    canvas.style.cursor = target ? 'copy' : 'crosshair';
    if (target !== this.linkTargetId) {
      this.linkTargetId = target;
      this.applyHighlight();
    }
    this.markDirty();
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const pointer = this.pointer;
    this.pointer = { kind: 'idle' };
    this.controls.enabled = true;
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (pointer.kind === 'orbit') {
      const still =
        Math.hypot(
          event.clientX - pointer.startX,
          event.clientY - pointer.startY,
        ) <= CLICK_TOLERANCE_PX;
      if (still && event.type === 'pointerup') this.callbacks.onSelect(null);
      return;
    }
    if (pointer.kind === 'card') {
      const still =
        Math.hypot(
          event.clientX - pointer.startX,
          event.clientY - pointer.startY,
        ) <= CLICK_TOLERANCE_PX;
      if (!still || event.type !== 'pointerup') return;
      if (pointer.target.kind === 'document') {
        this.callbacks.onOpenDocument(pointer.target.id);
      } else {
        this.callbacks.onAddDocument(pointer.target.nodeId);
      }
      return;
    }
    if (pointer.kind === 'idle') return;

    if (this.tempLine) {
      this.scene.remove(this.tempLine);
      disposeObject(this.tempLine);
      this.tempLine = null;
    }
    const target = this.linkTargetId;
    this.linkTargetId = null;
    this.applyHighlight();

    if (!pointer.moved || event.type === 'pointercancel') {
      if (event.ctrlKey || event.metaKey) {
        this.callbacks.onToggleSelect(pointer.nodeId);
      } else {
        this.callbacks.onSelect(pointer.nodeId);
      }
      return;
    }
    if (pointer.kind === 'move') {
      const sim = this.nodes.get(pointer.nodeId)?.sim;
      if (sim) {
        this.fixAt(sim, round(sim.x), round(sim.y), round(sim.z));
        this.callbacks.onPositionsChanged([
          { id: sim.id, x: sim.fx!, y: sim.fy!, z: sim.fz! },
        ]);
      }
      return;
    }
    if (target && target !== pointer.nodeId) {
      this.callbacks.onLink(pointer.nodeId, target);
    }
  };

  private readonly onDoubleClick = (event: MouseEvent) => {
    if (this.hitCard(event)) return;
    const id = this.hit(event);
    if (id) {
      this.callbacks.onOpen(id);
      return;
    }
    // Dans le vide : point du plan face à la caméra passant par le centre de la vue.
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new THREE.Vector3()),
      this.controls.target,
    );
    const point = this.pointOnPlane(event as PointerEvent, plane);
    if (point) {
      this.callbacks.onCreateAt({
        x: round(point.x),
        y: round(point.y),
        z: round(point.z),
      });
    }
  };

  private readonly onPointerLeave = () => {
    if (this.hoveredId && this.pointer.kind === 'idle') {
      this.hoveredId = null;
      this.applyHighlight();
    }
  };

  // --- Rendu ----------------------------------------------------------------

  private readonly markDirty = () => {
    this.dirty = true;
  };

  private readonly loop = () => {
    // Rendu à la demande : rien n'est dessiné tant que la scène est immobile.
    this.advanceFlight();
    const moving = this.controls.update();
    if (!moving && !this.dirty) return;
    this.dirty = false;
    this.layoutCards();
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.markDirty();
  }

  private applyThemeToScene(): void {
    const background = new THREE.Color(this.theme.background);
    this.scene.background = background;
    this.scene.fog = new THREE.Fog(background, 600, 2000);
  }

  private readonly onThemeChange = () => {
    this.theme = readTheme();
    const fog = this.scene.fog as THREE.Fog;
    const { near, far } = fog;
    this.applyThemeToScene();
    Object.assign(this.scene.fog as THREE.Fog, { near, far });
    for (const entry of this.nodes.values()) {
      entry.mesh.material.color.set(this.nodeColor(entry.data));
      if (entry.label) this.replaceNodeLabel(entry, entry.data.title);
    }
    // Les relations sont recréées au prochain setData ; forcer leur rafraîchissement.
    for (const entry of this.links.values()) entry.labelKey = '';
    this.applyHighlight();
  };
}
