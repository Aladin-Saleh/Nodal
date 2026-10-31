/**
 * Suggestions de liens : un document cite le titre d'un autre nœud sans
 * qu'aucune relation ne les relie. Correspondance exacte du titre, sans
 * accents ni casse, en mots entiers, hors code et hors liens [[...]].
 * Les titres trop courts ou trop génériques ne sont jamais proposés.
 */
import { foldText } from './text';
import { codeRanges, parseWikiLinks } from './wiki-links';

/** Longueur minimale d'un titre proposé (caractères, sans espaces). */
export const SUGGESTION_MIN_TITLE_LENGTH = 4;

/** Titres trop courants pour qu'une mention soit un vrai renvoi. */
const GENERIC_TITLES = new Set(
  [
    'notes',
    'note',
    'todo',
    'divers',
    'general',
    'generalites',
    'introduction',
    'index',
    'readme',
    'documentation',
    'doc',
    'docs',
    'autre',
    'autres',
    'misc',
    'test',
    'tests',
    'exemple',
    'exemples',
    'example',
    'examples',
    'donnees',
    'data',
    'config',
    'configuration',
    'resume',
    'description',
    'contexte',
    'questions',
    'idees',
    'liens',
    'references',
    'annexe',
    'annexes',
    'brouillon',
    'nouveau',
    'nouveau noeud',
    'sans titre',
  ].map(foldText),
);

const WORD = /[\p{L}\p{N}_]/u;

/** Titre normalisé (replié, espaces réduits) s'il peut être proposé. */
export function suggestibleTitle(title: string): string | null {
  const folded = foldText(title).replace(/\s+/gu, ' ').trim();
  if (folded.replace(/\s/gu, '').length < SUGGESTION_MIN_TITLE_LENGTH) {
    return null;
  }
  if (GENERIC_TITLES.has(folded)) return null;
  // Un nombre seul (« 2024 ») n'est pas un renvoi.
  if (/^[\p{N}\s.,-]+$/u.test(folded)) return null;
  return folded;
}

export interface TitleMention {
  /** Position et longueur de la mention dans le texte d'origine. */
  start: number;
  end: number;
}

/**
 * Index des mentions possibles d'un texte : version repliée et plages
 * exclues (code, liens [[...]]), calculées une fois pour tous les titres.
 */
export interface MentionIndex {
  folded: string;
  excluded: readonly [number, number][];
}

export function mentionIndex(body: string): MentionIndex {
  const links = parseWikiLinks(body).map((link): [number, number] => [
    link.start,
    link.end,
  ]);
  return { folded: foldText(body), excluded: [...codeRanges(body), ...links] };
}

/**
 * Première mention du titre (déjà passé par `suggestibleTitle`) en mot
 * entier, hors plages exclues ; `null` s'il n'y en a pas. Les espaces du
 * titre correspondent à n'importe quel blanc du texte.
 */
export function findTitleMention(
  index: MentionIndex,
  foldedTitle: string,
): TitleMention | null {
  const words = foldedTitle.split(' ');
  const first = words[0]!;
  const { folded, excluded } = index;
  for (
    let at = folded.indexOf(first);
    at !== -1;
    at = folded.indexOf(first, at + 1)
  ) {
    if (at > 0 && WORD.test(folded[at - 1]!)) continue;
    let end = at + first.length;
    let matched = true;
    for (const word of words.slice(1)) {
      const gap = /^\s+/u.exec(folded.slice(end));
      if (!gap || !folded.startsWith(word, end + gap[0].length)) {
        matched = false;
        break;
      }
      end += gap[0].length + word.length;
    }
    if (!matched || (end < folded.length && WORD.test(folded[end]!))) continue;
    if (excluded.some(([from, to]) => at < to && end > from)) continue;
    return { start: at, end };
  }
  return null;
}

const SNIPPET_RADIUS = 50;

/** Extrait autour d'une mention, sur une ligne. */
export function mentionSnippet(body: string, mention: TitleMention): string {
  const from = Math.max(0, mention.start - SNIPPET_RADIUS);
  const to = Math.min(body.length, mention.end + SNIPPET_RADIUS);
  const text = body.slice(from, to).replace(/\s+/gu, ' ').trim();
  return `${from > 0 ? '…' : ''}${text}${to < body.length ? '…' : ''}`;
}
