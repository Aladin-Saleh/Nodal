/**
 * Liens internes [[...]] des documents Markdown. Logique pure, partagée par
 * l'application (éditeur, aperçu), les services (relations issues des liens,
 * rétroliens) et le serveur MCP.
 *
 * Formes reconnues :
 * - `[[node:<uuid>]]` et `[[node:<uuid>|texte]]` : lien par identifiant, écrit
 *   par l'autocomplétion ; il survit aux renommages et s'affiche avec le titre
 *   courant du nœud (ou le texte donné) ;
 * - `[[Titre]]` et `[[Titre|texte]]` : lien par titre (saisie à la main,
 *   documents antérieurs), résolu sans tenir compte de la casse.
 * Les blocs de code et le code en ligne sont ignorés.
 */

export const NODE_LINK_ID_PREFIX = 'node:';

export type WikiLinkTarget =
  | { kind: 'id'; id: string }
  | { kind: 'title'; title: string };

export interface WikiLink {
  /** Position de `[[` et juste après `]]` dans le texte. */
  start: number;
  end: number;
  target: WikiLinkTarget;
  /** Texte affiché donné après `|`, sinon `null`. */
  text: string | null;
}

const LINK = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]/g;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Plages à ignorer : blocs ``` / ~~~ et code en ligne `…`. */
export function codeRanges(body: string): [number, number][] {
  const ranges: [number, number][] = [];
  const fence = /^(\s{0,3})(`{3,}|~{3,})[^\n]*$/gm;
  let open: { at: number; marker: string } | null = null;
  for (let match = fence.exec(body); match; match = fence.exec(body)) {
    const marker = match[2]!;
    if (!open) open = { at: match.index, marker };
    else if (
      marker[0] === open.marker[0] &&
      marker.length >= open.marker.length
    ) {
      ranges.push([open.at, match.index + match[0].length]);
      open = null;
    }
  }
  if (open) ranges.push([open.at, body.length]);
  const inline = /(`+)[^`\n]*?\1/g;
  for (let match = inline.exec(body); match; match = inline.exec(body)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

export function parseTarget(raw: string): WikiLinkTarget | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.toLowerCase().startsWith(NODE_LINK_ID_PREFIX)) {
    const id = value.slice(NODE_LINK_ID_PREFIX.length).trim();
    return ID.test(id) ? { kind: 'id', id: id.toLowerCase() } : null;
  }
  return { kind: 'title', title: value };
}

/** Liens du texte, dans l'ordre, hors code. */
export function parseWikiLinks(body: string): WikiLink[] {
  if (!body.includes('[[')) return [];
  const ranges = codeRanges(body);
  const inCode = (at: number) =>
    ranges.some(([from, to]) => at >= from && at < to);
  const links: WikiLink[] = [];
  for (const match of body.matchAll(LINK)) {
    const start = match.index;
    if (inCode(start)) continue;
    const target = parseTarget(match[1]!);
    if (!target) continue;
    const text = match[2]?.trim() || null;
    links.push({ start, end: start + match[0].length, target, text });
  }
  return links;
}

/** Lien canonique vers un nœud (par identifiant). */
export function formatNodeLink(id: string, text: string | null = null): string {
  return `[[${NODE_LINK_ID_PREFIX}${id}${text ? `|${text}` : ''}]]`;
}

export interface LinkResolver {
  /** Titre courant d'un nœud, ou `undefined` s'il n'existe pas. */
  titleOf(id: string): string | undefined;
  /** Identifiant d'un nœud par titre (sans casse), ou `undefined`. */
  idOfTitle(title: string): string | undefined;
}

/** Nœud visé par un lien, ou `null` si le lien est cassé. */
export function resolveTarget(
  target: WikiLinkTarget,
  resolver: LinkResolver,
): string | null {
  if (target.kind === 'id') {
    return resolver.titleOf(target.id) === undefined ? null : target.id;
  }
  return resolver.idOfTitle(target.title) ?? null;
}

/**
 * Résolveur sur une liste de nœuds. Plusieurs nœuds de même titre : le
 * premier de la liste l'emporte (ordre de l'arborescence).
 */
export function createLinkResolver(
  nodes: Iterable<{ id: string; title: string }>,
): LinkResolver {
  const titles = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const node of nodes) {
    titles.set(node.id, node.title);
    const key = node.title.trim().toLocaleLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, node.id);
  }
  return {
    titleOf: (id) => titles.get(id),
    idOfTitle: (title) => byTitle.get(title.trim().toLocaleLowerCase()),
  };
}

/** Nœuds visés par les liens résolus d'un texte (sans doublon). */
export function linkedNodeIds(body: string, resolver: LinkResolver): string[] {
  const ids = new Set<string>();
  for (const link of parseWikiLinks(body)) {
    const id = resolveTarget(link.target, resolver);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Réécrit chaque lien du texte : `replace` reçoit le lien et renvoie son
 * remplacement (le texte d'origine est gardé s'il renvoie `null`).
 */
export function rewriteWikiLinks(
  body: string,
  replace: (link: WikiLink, source: string) => string | null,
): string {
  const links = parseWikiLinks(body);
  if (links.length === 0) return body;
  let result = '';
  let at = 0;
  for (const link of links) {
    const source = body.slice(link.start, link.end);
    result += body.slice(at, link.start) + (replace(link, source) ?? source);
    at = link.end;
  }
  return result + body.slice(at);
}
