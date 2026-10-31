/**
 * Rendu Markdown sécurisé (§6.3) : le HTML brut est désactivé (échappé),
 * seuls les liens web, mail et internes sont conservés, et la syntaxe
 * [[...]] (voir shared/wiki-links) produit un lien vers un autre nœud.
 */
import MarkdownIt from 'markdown-it';
import {
  parseTarget,
  resolveTarget,
  type LinkResolver,
} from '../../../shared/wiki-links';

/** Préfixe des liens internes vers un nœud (jamais navigable par Chromium). */
export const NODE_LINK_PREFIX = 'nodal:node/';
/** Lien interne qui ne mène à aucun nœud (affiché, non navigable). */
export const BROKEN_LINK_PREFIX = 'nodal:broken/';

const SAFE_LINK = /^(https?:|mailto:)/i;

/** Contexte de rendu : résolution des liens [[...]] vers les nœuds. */
export interface MarkdownEnv {
  links?: LinkResolver;
}

type StateInline = Parameters<
  Parameters<MarkdownIt['inline']['ruler']['before']>[2]
>[0];

/**
 * Règle en ligne : [[cible]] ou [[cible|texte]] → lien interne. Résolu, il
 * mène au nœud (identifiant) et affiche son titre courant ; sinon il est
 * marqué comme cassé.
 */
function wikiLink(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (
    state.src.charCodeAt(start) !== 0x5b ||
    state.src.charCodeAt(start + 1) !== 0x5b
  ) {
    return false;
  }
  const end = state.src.indexOf(']]', start + 2);
  if (end === -1) return false;
  const inner = state.src.slice(start + 2, end);
  if (inner.includes('\n') || inner.includes('[')) return false;
  const separator = inner.indexOf('|');
  const raw = separator === -1 ? inner : inner.slice(0, separator);
  const alias = separator === -1 ? '' : inner.slice(separator + 1).trim();
  const target = parseTarget(raw);
  if (!target) return false;
  if (!silent) {
    const resolver = (state.env as MarkdownEnv | undefined)?.links;
    const id = resolver ? resolveTarget(target, resolver) : null;
    const fallback = target.kind === 'title' ? target.title : 'lien';
    const label =
      alias || (id ? (resolver?.titleOf(id) ?? fallback) : fallback);
    const open = state.push('link_open', 'a', 1);
    if (id) {
      open.attrs = [
        ['href', `${NODE_LINK_PREFIX}${encodeURIComponent(id)}`],
        ['class', 'node-link'],
      ];
    } else {
      open.attrs = [
        ['href', `${BROKEN_LINK_PREFIX}${encodeURIComponent(raw.trim())}`],
        ['class', 'node-link broken'],
        ['title', 'Lien cassé : aucun nœud ne correspond'],
      ];
    }
    const text = state.push('text', '', 0);
    text.content = label;
    state.push('link_close', 'a', -1);
  }
  state.pos = end + 2;
  return true;
}

export function createMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  md.validateLink = (url) =>
    SAFE_LINK.test(url) ||
    url.startsWith(NODE_LINK_PREFIX) ||
    url.startsWith(BROKEN_LINK_PREFIX);
  md.inline.ruler.before('link', 'wikilink', wikiLink);
  return md;
}

/** Nœud visé par un lien interne, ou `null` (autre lien, lien cassé). */
export function nodeLinkId(href: string): string | null {
  if (!href.startsWith(NODE_LINK_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(NODE_LINK_PREFIX.length));
  } catch {
    return null;
  }
}

export function isBrokenLink(href: string): boolean {
  return href.startsWith(BROKEN_LINK_PREFIX);
}

export function isExternalLink(href: string): boolean {
  return /^https?:/i.test(href);
}
