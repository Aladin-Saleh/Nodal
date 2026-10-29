import * as THREE from 'three';
import type { NodeType } from '../../../shared/domain';

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
const LABEL_MAX_CHARS = 40;

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
    sizeAttenuation: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
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
