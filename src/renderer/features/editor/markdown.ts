/**
 * Rendu Markdown sécurisé (§6.3) : le HTML brut est désactivé (échappé),
 * seuls les liens web, mail et internes sont conservés, et la syntaxe
 * [[Titre du nœud]] produit un lien vers un autre nœud de l'espace.
 */
import MarkdownIt from 'markdown-it';

/** Préfixe des liens internes vers un nœud (jamais navigable par Chromium). */
export const NODE_LINK_PREFIX = 'nodal:node/';

const SAFE_LINK = /^(https?:|mailto:)/i;

type StateInline = Parameters<
  Parameters<MarkdownIt['inline']['ruler']['before']>[2]
>[0];

/** Règle en ligne : [[Titre]] → lien interne. */
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
  const title = state.src.slice(start + 2, end).trim();
  if (!title || title.includes('\n')) return false;
  if (!silent) {
    const open = state.push('link_open', 'a', 1);
    open.attrs = [
      ['href', `${NODE_LINK_PREFIX}${encodeURIComponent(title)}`],
      ['class', 'node-link'],
    ];
    const text = state.push('text', '', 0);
    text.content = title;
    state.push('link_close', 'a', -1);
  }
  state.pos = end + 2;
  return true;
}

export function createMarkdownRenderer(): MarkdownIt {
  const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
  md.validateLink = (url) =>
    SAFE_LINK.test(url) || url.startsWith(NODE_LINK_PREFIX);
  md.inline.ruler.before('link', 'wikilink', wikiLink);
  return md;
}

/** Titre visé par un lien interne, ou `null` s'il ne s'agit pas d'un lien interne. */
export function nodeLinkTitle(href: string): string | null {
  if (!href.startsWith(NODE_LINK_PREFIX)) return null;
  try {
    return decodeURIComponent(href.slice(NODE_LINK_PREFIX.length));
  } catch {
    return null;
  }
}

export function isExternalLink(href: string): boolean {
  return /^https?:/i.test(href);
}
