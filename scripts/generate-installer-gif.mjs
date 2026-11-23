/**
 * Génère l'animation affichée par l'installateur Squirrel pendant
 * l'installation (assets/installer.gif) : « Aladinvention's Software » en art
 * ASCII et un golem qui rigole. Le texte est rendu par Electron (police
 * Consolas) dans une fenêtre hors écran, puis encodé en GIF sans dépendance.
 *
 * Usage : npx electron scripts/generate-installer-gif.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

const OUT = path.resolve('assets', 'installer.gif');
const WIDTH = 560;
const HEIGHT = 300;
/** Durée d'une image, en centièmes de seconde. */
const DELAY = 30;

const COLORS = {
  background: [24, 25, 28],
  stone: [154, 160, 171],
  eyes: [252, 196, 25],
  title: [116, 143, 252],
  text: [222, 226, 230],
};

// pyfiglet, police « small » (§ : accent grave, qui fermerait le gabarit).
const TITLE = String.raw`   _   _         _ _                 _   _          _
  /_\ | |__ _ __| (_)_ ___ _____ _ _| |_(_)___ _ _ ( )___
 / _ \| / _§ / _§ | | ' \ V / -_) ' \  _| / _ \ ' \|/(_-<
/_/ \_\_\__,_\__,_|_|_||_\_/\___|_||_\__|_\___/_||_| /__/

          ___       __ _
         / __| ___ / _| |___ __ ____ _ _ _ ___
         \__ \/ _ \  _|  _\ V  V / _§ | '_/ -_)
         |___/\___/_|  \__|\_/\_/\__,_|_| \___|`.replaceAll('§', '`');

/** Golem : `E` = yeux, `M` = bouche (remplacés selon l'image). */
const GOLEM = String.raw`     .-~~~~~~~~-.
    /  __    __  \
   |  ( E)  ( E)  |
   |      /\      |
   |  MMMMMMMMMM  |
    \            /
  .--'-.______.-'--.
 /  |   [####]   |  \
|[] |     ||     | []|
|   |____/  \____|   |
(_)  |    ||    |  (_)
     |____||____|
    [_____][_____]`;

const FACES = [
  { eyes: ['^', '^'], mouth: '\\________/' },
  { eyes: ['>', '<'], mouth: '\\ VVVVVV /' },
];
const LAUGHS = ['', 'HA !', 'HA ! HA !', 'HA ! HA ! HA !'];

const escape = (text) =>
  text.replace(
    /[&<>]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c],
  );
const rgb = ([r, g, b]) => `rgb(${r},${g},${b})`;

function golemHtml(face, shift) {
  let eye = 0;
  const lines = escape(GOLEM)
    .replace(/\( E\)/g, () => `( <b>${escape(face.eyes[eye++])}</b>)`)
    .replace('MMMMMMMMMM', face.mouth)
    .split('\n');
  return lines.map((line) => ' '.repeat(shift) + line).join('\n');
}

function frameHtml(index) {
  const face = FACES[index % 2];
  const laugh = LAUGHS[index % LAUGHS.length];
  const cursor = index % 2 === 0 ? '_' : ' ';
  return `
    <div class="row">
      <div><div class="laugh">${laugh || '&nbsp;'}</div><pre class="golem">${golemHtml(face, index % 2)}</pre></div>
      <pre class="title">${escape(TITLE)}</pre>
    </div>
    <pre class="status">Installation de Nodal en cours${cursor}</pre>`;
}

const PAGE = `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    background: ${rgb(COLORS.background)}; }
  body { display: flex; flex-direction: column; justify-content: center;
    padding: 0 18px; box-sizing: border-box; font: 11px/13px Consolas, monospace; }
  pre { margin: 0; font: inherit; }
  .row { display: flex; align-items: flex-end; gap: 14px; }
  .laugh { color: ${rgb(COLORS.eyes)}; font-weight: bold; padding-left: 4px; height: 18px; }
  .golem { color: ${rgb(COLORS.stone)}; }
  .golem b { color: ${rgb(COLORS.eyes)}; }
  .title { color: ${rgb(COLORS.title)}; padding-bottom: 22px; }
  .status { color: ${rgb(COLORS.text)}; margin-top: 22px; text-align: center; }
</style><body></body>`;

/**
 * Palette : dégradés du fond vers chaque couleur (l'anticrénelage du texte
 * produit les teintes intermédiaires).
 */
function buildPalette() {
  const inks = [COLORS.stone, COLORS.eyes, COLORS.title, COLORS.text];
  const steps = Math.floor(255 / inks.length);
  const palette = [COLORS.background];
  for (const ink of inks) {
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      palette.push(
        COLORS.background.map((c, i) => Math.round(c + (ink[i] - c) * t)),
      );
    }
  }
  while (palette.length < 256) palette.push(COLORS.background);
  return palette;
}

/** Image BGRA → indices de la palette (couleur la plus proche). */
function quantize(bgra, palette) {
  const cache = new Map();
  const indices = new Uint8Array(bgra.length / 4);
  for (let p = 0; p < indices.length; p++) {
    const b = bgra[p * 4];
    const g = bgra[p * 4 + 1];
    const r = bgra[p * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let best = cache.get(key);
    if (best === undefined) {
      let bestDistance = Infinity;
      for (let i = 0; i < palette.length; i++) {
        const [pr, pg, pb] = palette[i];
        const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
        if (d < bestDistance) [best, bestDistance] = [i, d];
      }
      cache.set(key, best);
    }
    indices[p] = best;
  }
  return indices;
}

/** Compression LZW du GIF (taille de code minimale : 8 bits). */
function lzw(indices) {
  const clear = 256;
  const end = 257;
  const out = [];
  let codeSize = 9;
  let next = 258;
  let dict = new Map();
  let buffer = 0;
  let bits = 0;
  const emit = (code) => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      out.push(buffer & 255);
      buffer >>>= 8;
      bits -= 8;
    }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = dict.get(key);
    if (code !== undefined) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      if (next >= 1 << codeSize) codeSize++;
      dict.set(key, next++);
    } else {
      emit(clear);
      dict = new Map();
      next = 258;
      codeSize = 9;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bits > 0) out.push(buffer & 255);
  return out;
}

/** Données découpées en sous-blocs d'au plus 255 octets. */
function subBlocks(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

function encodeGif(frames, palette) {
  const u16 = (n) => [n & 255, n >> 8];
  const bytes = [
    ...Buffer.from('GIF89a'),
    ...u16(WIDTH),
    ...u16(HEIGHT),
    0xf7, // table de couleurs globale de 256 entrées
    0,
    0,
    ...palette.flat(),
    // Boucle infinie (extension NETSCAPE2.0).
    0x21,
    0xff,
    11,
    ...Buffer.from('NETSCAPE2.0'),
    3,
    1,
    0,
    0,
    0,
  ];
  for (const indices of frames) {
    bytes.push(0x21, 0xf9, 4, 0x04, ...u16(DELAY), 0, 0);
    bytes.push(0x2c, 0, 0, 0, 0, ...u16(WIDTH), ...u16(HEIGHT), 0);
    bytes.push(8, ...subBlocks(lzw(indices)));
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`,
  );
  const palette = buildPalette();
  const frames = [];
  for (let i = 0; i < 2 * LAUGHS.length; i++) {
    await window.webContents.executeJavaScript(
      `document.body.innerHTML = ${JSON.stringify(frameHtml(i))};
       new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));`,
    );
    const image = (await window.webContents.capturePage()).resize({
      width: WIDTH,
      height: HEIGHT,
    });
    frames.push(quantize(image.toBitmap(), palette));
  }
  fs.writeFileSync(OUT, encodeGif(frames, palette));
  console.log(`${path.relative(process.cwd(), OUT)} : ${frames.length} images`);
  app.quit();
});
