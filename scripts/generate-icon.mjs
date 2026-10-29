/**
 * Génère l'icône de l'application (assets/icon.png et assets/icon.ico) sans
 * dépendance : un petit graphe de nœuds aux couleurs des types, sur fond
 * sombre arrondi. Rendu vectoriel avec anticrénelage par sur-échantillonnage.
 *
 * Usage : node scripts/generate-icon.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.resolve('assets');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Scène dans un repère 0..1.
const NODES = [
  { x: 0.5, y: 0.3, r: 0.12, color: [59, 91, 219] }, // concept
  { x: 0.27, y: 0.62, r: 0.1, color: [47, 158, 68] }, // composant
  { x: 0.73, y: 0.62, r: 0.1, color: [232, 89, 12] }, // donnée
  { x: 0.5, y: 0.8, r: 0.075, color: [156, 54, 181] }, // procédure
];
const EDGES = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 3],
  [1, 2],
];
const BACKGROUND = [30, 31, 34];
const EDGE_COLOR = [200, 204, 214];

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Couleur RGBA d'un point de la scène (sans anticrénelage). */
function shade(x, y) {
  // Carré arrondi.
  const margin = 0.04;
  const radius = 0.2;
  const cx = Math.min(Math.max(x, margin + radius), 1 - margin - radius);
  const cy = Math.min(Math.max(y, margin + radius), 1 - margin - radius);
  if (Math.hypot(x - cx, y - cy) > radius) return [0, 0, 0, 0];
  let color = BACKGROUND;
  for (const [a, b] of EDGES) {
    const p = NODES[a];
    const q = NODES[b];
    if (distanceToSegment(x, y, p.x, p.y, q.x, q.y) < 0.022) color = EDGE_COLOR;
  }
  for (const node of NODES) {
    const d = Math.hypot(x - node.x, y - node.y);
    if (d < node.r) {
      // Léger relief : plus clair en haut à gauche.
      const light =
        1.25 -
        (0.5 *
          Math.hypot(
            x - (node.x - node.r * 0.35),
            y - (node.y - node.r * 0.35),
          )) /
          node.r;
      color = node.color.map((c) =>
        Math.max(0, Math.min(255, Math.round(c * light))),
      );
    } else if (d < node.r + 0.018) {
      color = BACKGROUND;
    }
  }
  return [...color, 255];
}

function render(size) {
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const [r, g, b, a] = shade(
            (px + (sx + 0.5) / samples) / size,
            (py + (sy + 0.5) / samples) / size,
          );
          sum[0] += r * a;
          sum[1] += g * a;
          sum[2] += b * a;
          sum[3] += a;
        }
      }
      const offset = (py * size + px) * 4;
      const alpha = sum[3] / (samples * samples);
      pixels[offset] = sum[3] ? Math.round(sum[0] / sum[3]) : 0;
      pixels[offset + 1] = sum[3] ? Math.round(sum[1] / sum[3]) : 0;
      pixels[offset + 2] = sum[3] ? Math.round(sum[2] / sum[3]) : 0;
      pixels[offset + 3] = Math.round(alpha);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profondeur
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre : aucun
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO contenant des images PNG (format accepté depuis Windows Vista). */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // plans
    entry.writeUInt16LE(32, 6); // bits par pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([
    header,
    ...entries,
    ...images.map((image) => image.png),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
const images = SIZES.map((size) => ({
  size,
  png: encodePng(size, render(size)),
}));
fs.writeFileSync(path.join(OUT, 'icon.png'), images.at(-1).png);
fs.writeFileSync(path.join(OUT, 'icon.ico'), encodeIco(images));
console.log(`Icônes générées dans ${OUT} (${SIZES.join(', ')} px)`);
