/**
 * Liens [[...]] des documents échangés avec le LLM. En lecture, un lien est
 * écrit `[[Titre]](id)` ou `[[Titre|texte]](id)` : titre courant lisible et
 * identifiant court réutilisable. En écriture, cette forme est reconvertie en
 * lien par identifiant (`[[node:<uuid>]]`), qui survit aux renommages.
 */
import {
  formatNodeLink,
  resolveTarget,
  rewriteWikiLinks,
  type LinkResolver,
} from '../shared/wiki-links';
import type { ShortIds } from './short-ids';

/** Lien tel que servi au LLM. */
export function renderLinksForLlm(
  body: string,
  resolver: LinkResolver,
  ids: ShortIds,
): string {
  if (!body.includes('[[')) return body;
  return rewriteWikiLinks(body, (link) => {
    const id = resolveTarget(link.target, resolver);
    if (!id) {
      const raw =
        link.target.kind === 'title' ? link.target.title : 'nœud supprimé';
      return `[[${link.text ?? raw} (lien cassé)]]`;
    }
    const title = resolver.titleOf(id)!;
    return `[[${title}${link.text ? `|${link.text}` : ''}]](${ids.short(id)})`;
  });
}

/** `[[Titre]](id)` ou `[[Titre|texte]](id)`, id court ou complet. */
const SERVED_LINK =
  /\[\[([^[\]\n|]+)(?:\|([^[\]\n]+))?\]\]\(([0-9a-f]{8}[0-9a-f-]{0,28})\)/gi;

/**
 * Reconvertit les liens servis (`[[Titre]](id)`) en liens par identifiant ;
 * un identifiant inconnu, ambigu ou qui n'est pas un nœud laisse le texte
 * tel quel. Les liens `[[Titre]]` restent des liens par titre.
 */
export function canonicalizeLlmLinks(
  body: string,
  ids: ShortIds,
  isNode: (id: string) => boolean,
): string {
  if (!body.includes('[[')) return body;
  return body.replace(SERVED_LINK, (source, _title: string, text, short) => {
    let id: string;
    try {
      id = ids.resolve(short);
    } catch {
      return source;
    }
    if (!isNode(id)) return source;
    return formatNodeLink(id, (text as string | undefined)?.trim() || null);
  });
}

/**
 * Applique `renderLinksForLlm` aux contenus de documents d'une réponse :
 * champs `body` (document entier ou tranche) et `content` (sections).
 */
export function renderResponseLinks<T>(
  value: T,
  render: (text: string) => string,
): T {
  if (Array.isArray(value)) {
    return value.map((item) => renderResponseLinks(item, render)) as T;
  }
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      (key === 'body' || key === 'content') && typeof item === 'string'
        ? render(item)
        : renderResponseLinks(item, render),
    ]),
  ) as T;
}
