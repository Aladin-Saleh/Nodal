import * as THREE from 'three';
import type { ContentType, NodeType } from '../../../shared/domain';

/** Rayon de référence d'un nœud (unités de la scène). */
export const NODE_RADIUS = 9;

/** Forme de chaque type : le type se lit aussi sans la couleur (§5.2). */
export function createNodeGeometry(type: NodeType): THREE.BufferGeometry {
  const r = NODE_RADIUS;
  switch (type) {
    case 'concept':
      return new THREE.SphereGeometry(r, 32, 16);
    case 'component':
      return new THREE.BoxGeometry(r * 1.6, r * 1.6, r * 1.6);
    case 'data':
      return new THREE.CylinderGeometry(r * 0.9, r * 0.9, r * 1.6, 32);
    case 'procedure':
      return new THREE.OctahedronGeometry(r * 1.15);
    case 'resource':
      return new THREE.ConeGeometry(r, r * 1.9, 32);
    case 'generic':
      return new THREE.DodecahedronGeometry(r);
  }
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

export interface GraphTheme {
  background: string;
  edge: string;
  hierarchy: string;
  accent: string;
  typeColors: Record<NodeType, string>;
}

/** Couleurs lues dans les variables CSS : la scène suit le thème clair/sombre. */
export function readTheme(): GraphTheme {
  const type = (name: NodeType, fallback: string) =>
    cssVar(`--type-${name}`, fallback);
  return {
    background: cssVar('--bg', '#1e1f22'),
    edge: cssVar('--muted', '#a2a5ad'),
    hierarchy: cssVar('--border', '#3f4147'),
    accent: cssVar('--accent', '#5c7cfa'),
    typeColors: {
      concept: type('concept', '#3b5bdb'),
      component: type('component', '#2f9e44'),
      data: type('data', '#e8590c'),
      procedure: type('procedure', '#9c36b5'),
      resource: type('resource', '#0c8599'),
      generic: type('generic', '#868e96'),
    },
  };
}

const LABEL_FONT_PX = 40;
export const LABEL_MAX_CHARS = 40;

/**
 * Étiquette texte dessinée dans un canevas puis plaquée sur un sprite :
 * aucun élément DOM ni style en ligne (compatible avec la CSP).
 * `height` est une fraction de la hauteur de la vue : la taille à l'écran
 * reste constante quel que soit le zoom. L'étiquette est ancrée par le bas.
 */
export function createLabel(
  text: string,
  options: { height: number; background: string; color: string },
): THREE.Sprite {
  const shown =
    text.length > LABEL_MAX_CHARS
      ? `${text.slice(0, LABEL_MAX_CHARS - 1)}…`
      : text;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const font = `600 ${LABEL_FONT_PX}px "Segoe UI", system-ui, sans-serif`;
  context.font = font;
  const padding = LABEL_FONT_PX * 0.45;
  const width = Math.ceil(context.measureText(shown).width + padding * 2);
  const height = Math.ceil(LABEL_FONT_PX * 1.5);
  canvas.width = width;
  canvas.height = height;

  context.font = font;
  context.fillStyle = options.background;
  context.beginPath();
  context.roundRect(0, 0, width, height, height / 2);
  context.fill();
  context.fillStyle = options.color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(shown, width / 2, height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    // Toujours lisible : dessinée par-dessus les formes (le placement évite
    // déjà les chevauchements, voir declutterLabels).
    depthTest: false,
    sizeAttenuation: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 5;
  sprite.center.set(0.5, 0);
  sprite.scale.set((options.height * width) / height, options.height, 1);
  return sprite;
}

export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      (material as THREE.MeshBasicMaterial).map?.dispose();
      material.dispose();
    }
  });
}

const CARD_BADGES: Record<
  ContentType | 'add',
  { text: string; color: string }
> = {
  markdown: { text: 'MD', color: '#4dabf7' },
  text: { text: 'TXT', color: '#adb5bd' },
  json: { text: 'JSON', color: '#fab005' },
  code: { text: 'CODE', color: '#38d9a9' },
  mermaid: { text: 'MMD', color: '#da77f2' },
  add: { text: '+', color: '#5c7cfa' },
};

/** Dimensions d'une page de document (unités de la scène). */
export const PAGE_WIDTH = 12;
export const PAGE_HEIGHT = 15;
const PAGE_DEPTH = 1.6;

/** Face avant d'une page : badge du type (ou du langage) en grand. */
function pageFaceTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 230;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#f8f9fa';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Bandeau coloré et lignes de texte stylisées.
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, 56);
  context.fillStyle = '#ced4da';
  for (let y = 150; y < 215; y += 16) {
    context.fillRect(22, y, canvas.width - 44 - (y % 32 === 0 ? 30 : 0), 6);
  }
  context.fillStyle = '#212529';
  const size = text.length > 4 ? 40 : 54;
  context.font = `800 ${size}px "Segoe UI", system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, 103);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Document représenté par une « page » 3D (même échelle que les nœuds) :
 * face avant marquée du type, tranche colorée, titre à droite. Le groupe est
 * orienté face à la caméra par la scène.
 */
export function createDocumentPage(
  title: string,
  kind: ContentType | 'add',
  language: string | null,
  options: { labelHeight: number; background: string; color: string },
): THREE.Group {
  const badge = CARD_BADGES[kind];
  const badgeText =
    kind === 'code' && language
      ? language.toUpperCase().slice(0, 6)
      : badge.text;
  const side = new THREE.MeshStandardMaterial({
    color: badge.color,
    roughness: 0.5,
    metalness: 0.05,
  });
  const front = new THREE.MeshStandardMaterial({
    map: pageFaceTexture(badgeText, badge.color),
    roughness: 0.6,
    transparent: kind === 'add',
    opacity: kind === 'add' ? 0.75 : 1,
  });
  // Ordre des faces d'une boîte : +x, -x, +y, -y, +z (avant), -z.
  const page = new THREE.Mesh(
    new THREE.BoxGeometry(PAGE_WIDTH, PAGE_HEIGHT, PAGE_DEPTH),
    [side, side, side, side, front, side],
  );
  const label = createLabel(title, {
    height: options.labelHeight,
    background: options.background,
    color: options.color,
  });
  label.center.set(0, 0.5);
  label.position.set(PAGE_WIDTH / 2 + 1.5, 0, 0);
  const group = new THREE.Group();
  group.add(page, label);
  return group;
}
