/**
 * Ancrage des nœuds aux fichiers du code : un nœud est ancré à des chemins
 * ou à des motifs glob relatifs aux dossiers de code de l'espace (ex.
 * `src/mcp/**`). Fonctions pures, partagées par l'application et le serveur
 * MCP.
 *
 * Les motifs suivent la syntaxe des pathspecs `:(glob)` de git, pour que la
 * même chaîne serve à la correspondance ici et à `git log` :
 * - `*` : n'importe quels caractères sauf `/` ; `?` : un caractère sauf `/` ;
 * - `**` : n'importe quels dossiers (`src/**`, `** /test.ts`, `a/** /b`) ;
 * - sans joker, un chemin désigne le fichier ou tout le dossier.
 * Les classes `[...]`, accolades et négations ne sont pas acceptées.
 *
 * Plusieurs dossiers de code : `api:src/**` ne vaut que pour celui nommé `api`
 * (`src/**` vaut pour tous).
 */

/** Longueur maximale d'un motif (caractères). */
export const ANCHOR_PATTERN_MAX_LENGTH = 300;
/** Motifs au plus par nœud. */
export const ANCHORS_MAX_PER_NODE = 50;
/** Dossiers de code au plus par espace. */
export const CODE_ROOTS_MAX = 50;

/** Résultat d'une validation : le motif normalisé, ou la raison du refus. */
export type PatternCheck =
  | { ok: true; pattern: string }
  | { ok: false; reason: string };

/** Dossier de code (nom, `null` : tous) et motif ou chemin relatif. */
export function splitAnchor(value: string): {
  root: string | null;
  path: string;
} {
  const match = /^([^/\\:*?]+):([^]*)$/.exec(value);
  return match
    ? { root: match[1]!, path: match[2]! }
    : { root: null, path: value };
}

/** Nom d'un dossier de code : dernière partie de son chemin. */
export const rootName = (root: string) =>
  cleanSlashes(root).split('/').at(-1) ?? '';

/** Même dossier de code, si les deux sont précisés. */
const sameRoot = (
  a: string | null,
  b: string | null,
  caseInsensitive: boolean,
) =>
  a === null ||
  b === null ||
  (caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b);

/** Motif sans son dossier de code ; `null` s'il vise un autre dossier. */
export function patternIn(
  pattern: string,
  root: string,
  caseInsensitive = false,
): string | null {
  const split = splitAnchor(pattern);
  return sameRoot(split.root, rootName(root), caseInsensitive)
    ? split.path
    : null;
}

/** Séparateurs `/`, sans `./` initial, `//` ni `/` final. */
function cleanSlashes(raw: string): string {
  let value = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  while (value.startsWith('./')) value = value.slice(2);
  return value.replace(/\/+$/, '');
}

/** Chemin absolu Windows (`C:/…`, `//serveur/…`) ou POSIX (`/…`). */
export function isAbsolutePath(value: string): boolean {
  const slashed = value.replace(/\\/g, '/');
  return /^[a-z]:\//i.test(slashed) || slashed.startsWith('/');
}

/**
 * Valide et normalise un motif d'ancrage. Refusés : chemin absolu, `..`,
 * caractères de contrôle et syntaxe glob non portable (`[`, `{`, `!` initial,
 * `:` initial des pathspecs magiques de git).
 */
export function normalizeAnchorPattern(raw: string): PatternCheck {
  if (raw.length > ANCHOR_PATTERN_MAX_LENGTH) {
    return {
      ok: false,
      reason: `Motif trop long (${ANCHOR_PATTERN_MAX_LENGTH} caractères au plus).`,
    };
  }
  if (isAbsolutePath(raw.trim())) {
    return {
      ok: false,
      reason:
        'Le motif doit être relatif à un dossier de code (ex. src/mcp/**).',
    };
  }
  const { root, path } = splitAnchor(raw.trim());
  const pattern = cleanSlashes(path);
  if (root !== null && isAbsolutePath(path)) {
    return { ok: false, reason: 'Chemin absolu après le nom du dossier.' };
  }
  if (!pattern || pattern === '.') {
    return { ok: false, reason: 'Motif vide.' };
  }
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw.trim())) {
    return { ok: false, reason: 'Le motif contient un caractère invalide.' };
  }
  if (/[[\]{}]/.test(pattern) || /^[!:]/.test(pattern)) {
    return {
      ok: false,
      reason: 'Seuls les jokers *, ** et ? sont acceptés dans un motif.',
    };
  }
  const segments = pattern.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return {
      ok: false,
      reason: 'Le motif ne peut pas sortir du dossier de code (..).',
    };
  }
  return {
    ok: true,
    pattern: root === null ? pattern : `${root}:${pattern}`,
  };
}

export const isGlobPattern = (pattern: string) => /[*?]/.test(pattern);

const escapeRegExp = (text: string) =>
  text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** Expression régulière d'un motif, sans son dossier de code. */
export function anchorRegExp(pattern: string, caseInsensitive = false): RegExp {
  const flags = caseInsensitive ? 'i' : '';
  if (!isGlobPattern(pattern)) {
    // Le fichier lui-même, ou tout ce que contient le dossier.
    return new RegExp(`^${escapeRegExp(pattern)}(?:/.*)?$`, flags);
  }
  const segments = pattern.split('/');
  let source = '';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') {
      // `**/` : zéro ou plusieurs dossiers ; `**` final : tout le reste.
      source += last ? '.*' : '(?:[^/]+/)*';
      return;
    }
    source += segment
      .split('')
      .map((char) => {
        if (char === '*') return '[^/]*';
        if (char === '?') return '[^/]';
        return escapeRegExp(char);
      })
      .join('');
    if (!last) source += '/';
  });
  // Comme git : un motif qui désigne un dossier couvre aussi son contenu.
  return new RegExp(`^${source}(?:/.*)?$`, flags);
}

/** Le chemin relatif (dossier de code précisé ou non) correspond-il au motif ? */
export function matchesAnchor(
  pattern: string,
  relativePath: string,
  caseInsensitive = false,
): boolean {
  const anchor = splitAnchor(pattern);
  const file = splitAnchor(relativePath);
  return (
    sameRoot(anchor.root, file.root, caseInsensitive) &&
    anchorRegExp(anchor.path, caseInsensitive).test(file.path)
  );
}

/**
 * Partie fixe d'un motif, avant le premier joker : le dossier à parcourir
 * pour trouver les fichiers correspondants (`src/mcp/**` → `src/mcp`).
 */
export function staticPrefix(pattern: string): string {
  const segments = splitAnchor(pattern).path.split('/');
  const fixed: string[] = [];
  for (const segment of segments) {
    if (isGlobPattern(segment)) break;
    fixed.push(segment);
  }
  return fixed.join('/');
}

/**
 * Chemin (absolu, ou relatif à un dossier de code) → chemin relatif à l'un
 * des dossiers de code `roots` (absolus). `null` si un chemin absolu n'est
 * dans aucun d'eux. Un chemin relatif est seulement normalisé.
 */
export function toRootRelative(
  input: string,
  roots: readonly string[],
  caseInsensitive = false,
): { root: string | null; path: string } | null {
  const value = cleanSlashes(input);
  if (!isAbsolutePath(value)) return { root: null, path: value };
  const fold = (text: string) => (caseInsensitive ? text.toLowerCase() : text);
  // Le dossier le plus profond l'emporte (dossiers imbriqués).
  const sorted = roots.toSorted((a, b) => b.length - a.length);
  for (const root of sorted) {
    const base = cleanSlashes(root);
    if (fold(value) === fold(base)) return { root, path: '' };
    if (fold(value).startsWith(`${fold(base)}/`)) {
      return { root, path: value.slice(base.length + 1) };
    }
  }
  return null;
}

/**
 * Chemin ou motif à enregistrer ou à chercher : relatif à un dossier de code,
 * dont le nom est précisé s'il y en a plusieurs. Un chemin relatif est pris
 * dans `home` (dossier où travaille l'assistant) s'il est l'un d'eux. `null` :
 * hors des dossiers de code.
 */
export function qualifiedPath(
  input: string,
  roots: readonly string[],
  caseInsensitive = false,
  home: string | null = null,
): string | null {
  if (!isAbsolutePath(input.trim()) && splitAnchor(input.trim()).root !== null)
    return input.trim().replace(/\\/g, '/');
  const found = toRootRelative(input, roots, caseInsensitive);
  if (!found?.path) return null;
  if (roots.length < 2) return found.path;
  const root =
    found.root ??
    (home === null ? null : toRootRelative(home, roots, caseInsensitive)?.root);
  return root ? `${rootName(root)}:${found.path}` : found.path;
}

/** Un fichier modifié depuis la dernière mise à jour d'un nœud. */
export interface ChangedFile {
  /** Chemin relatif au dossier de code. */
  path: string;
  /** Date de la modification (ISO 8601). */
  changedAt: string;
  /** Le fichier n'existe plus. */
  deleted?: boolean;
  /** Le fichier n'existait pas. */
  added?: boolean;
}

/**
 * Contenu du code que reflète la documentation d'un nœud : empreinte de
 * chaque fichier ancré, à la date de référence du nœud.
 */
export interface CodeSnapshot {
  /** Date de référence du nœud ; une autre date rend l'état caduc. */
  since: string;
  /** Motifs ancrés quand l'état a été relevé. */
  patterns: string[];
  /**
   * `dossier/chemin` → empreinte. `null` : contenu inconnu (la date en
   * décide) ; `''` : contenu dépassé, à relire.
   */
  files: Record<string, string | null>;
}

/** Nœud dont la documentation est possiblement obsolète. */
export interface StaleNode {
  nodeId: string;
  /** Date de référence : dernière mise à jour du nœud ou de ses documents. */
  since: string;
  /** Fichiers modifiés depuis, les plus récents d'abord (liste plafonnée). */
  files: ChangedFile[];
  /** Nombre exact de fichiers modifiés. */
  fileCount: number;
  /**
   * `content` : contenu comparé ; `mtime` : un fichier au moins n'est jugé
   * que sur sa date (contenu de référence inconnu).
   */
  source: 'content' | 'mtime';
}

/** Fichiers couverts par un motif ancré (panneau du nœud). */
export interface AnchorFiles {
  pattern: string;
  /** Chemins relatifs (préfixés du nom du dossier s'il y en a plusieurs). */
  files: string[];
  /** Nombre de fichiers trouvés ; 0 : introuvable. */
  count: number;
  /** Parcours borné : le compte est un minimum. */
  truncated: boolean;
}

/** Dossier de code déclaré pour l'espace. */
export interface CodeRootInfo {
  path: string;
  exists: boolean;
}

/** Ancrage d'un nœud : motifs et fichiers, et obsolescence éventuelle. */
export interface NodeAnchors {
  anchors: AnchorFiles[];
  /** `null` : à jour (ou rien d'ancré). */
  stale: StaleNode | null;
  /** L'espace déclare au moins un dossier de code. */
  hasRoots: boolean;
}
