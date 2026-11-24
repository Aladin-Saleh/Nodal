/**
 * Doublons probables : deux titres qui se lisent comme le même nom, à une
 * coquille, une liaison ou un pluriel près. Dans le doute, rien n'est
 * signalé : deux noms proches désignent souvent deux choses. Logique pure.
 */
import { foldText } from './text';

/** Clé de comparaison des titres : sans accents, casse, ponctuation ni pluriel. */
export function titleKey(title: string): string {
  return foldText(title)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .map((word) => (word.length > 3 ? word.replace(/[sx]$/u, '') : word))
    .join(' ');
}

/** Mots de liaison : leur présence ne change pas ce qui est nommé. */
const LINKING_WORDS = new Set(
  (
    'a au aux d de des du en et l la le les ou par pour sur un une ' +
    'an and for in of on or the to with'
  ).split(' '),
);

/**
 * Titres courants qu'on retrouve sous plusieurs parents sans que ce soit la
 * même chose (clés de titre).
 */
const GENERIC_TITLES = new Set(
  (
    'api|architecture|conception|configuration|decision|depannage|divers|' +
    'documentation|exemple|fonctionnement|historique|installation|' +
    'introduction|limite|note|objectif|overview|probleme|question|resume|' +
    'securite|setup|test|todo|usage|utilisation|vue d ensemble'
  ).split('|'),
);

const withoutLinkingWords = (key: string) =>
  key
    .split(' ')
    .filter((word) => !LINKING_WORDS.has(word))
    .join(' ');

/** Nombres d'un titre, sans zéros de tête, triés. */
const numbersOf = (key: string) =>
  (key.match(/\d+/g) ?? [])
    .map((digits) => digits.replace(/^0+(?=\d)/, ''))
    .toSorted()
    .join(' ');

/** Une lettre remplacée, ou deux voisines interverties. */
function oneTypo(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const differing = [...Array.from(a).keys()].filter(
    (index) => a[index] !== b[index],
  );
  if (differing.length === 1) return true;
  const [first, second] = differing;
  return (
    differing.length === 2 &&
    second === first! + 1 &&
    a[first!] === b[second] &&
    a[second] === b[first!]
  );
}

/** Deux mots qui sont le même, mal orthographié. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  // Une lettre isolée nomme une variante (« Serveur A », « Serveur B »).
  if (Math.min(a.length, b.length) < 5) return false;
  if (a.length === b.length) return oneTypo(a, b);
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  // Lettre ajoutée devant : un mot dérivé, souvent le contraire (synchrone,
  // asynchrone), pas une coquille.
  if (longer.endsWith(shorter) || shorter.length < 6) return false;
  return (
    longer.length === shorter.length + 1 &&
    [...Array.from(longer).keys()].some(
      (index) => longer.slice(0, index) + longer.slice(index + 1) === shorter,
    )
  );
}

/** Deux clés de titre désignent-elles probablement la même chose ? */
export function sameTitle(a: string, b: string): boolean {
  if (a === b) return true;
  if (numbersOf(a) !== numbersOf(b)) return false;
  const zeros = (key: string) => key.replace(/\b0+(?=\d)/g, '');
  const [x, y] = [a, b].map((key) => withoutLinkingWords(zeros(key)));
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.replaceAll(' ', '') === y.replaceAll(' ', '')) return true;
  const [left, right] = [x.split(' '), y.split(' ')];
  return (
    left.length === right.length &&
    left.every((word, index) => sameWord(word, right[index]!))
  );
}

function push(map: Map<string, string[]>, key: string, id: string): void {
  const list = map.get(key);
  if (list) list.push(id);
  else map.set(key, [id]);
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  parentId?: string | null;
}

/** Identifiant d'une paire, quel que soit l'ordre. */
export const pairKey = (a: string, b: string) =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

/**
 * Paires de nœuds aux titres probablement en double. Les candidats partagent
 * une clé, éventuellement privée d'une lettre (suppressions symétriques : pas
 * de comparaison de toutes les paires), puis sont vérifiés (sameTitle).
 */
export function duplicatePairs(
  nodes: readonly DuplicateCandidate[],
): [string, string][] {
  const keys = new Map<string, { key: string; parentId: string | null }>();
  const buckets = new Map<string, string[]>();
  for (const node of nodes) {
    const key = titleKey(node.title);
    if (!key) continue;
    keys.set(node.id, { key, parentId: node.parentId ?? null });
    const compact = withoutLinkingWords(
      key.replace(/\b0+(?=\d)/g, ''),
    ).replaceAll(' ', '');
    const forms = new Set([compact || key]);
    if (compact.length >= 6) {
      for (let index = 0; index < compact.length; index++) {
        // Lettres seulement : « Étape 1 » et « Étape 2 » ne sont pas des doublons.
        if (/\p{L}/u.test(compact[index]!))
          forms.add(compact.slice(0, index) + compact.slice(index + 1));
      }
      // Deux lettres interverties : même ensemble de lettres.
      forms.add(`≈${[...compact].toSorted().join('')}`);
    }
    for (const form of forms) push(buckets, form, node.id);
  }
  const pairs = new Map<string, [string, string]>();
  for (const ids of buckets.values()) {
    if (ids.length < 2 || ids.length > 20) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [ids[i]!, ids[j]!];
        if (a === b || pairs.has(pairKey(a, b))) continue;
        const [x, y] = [keys.get(a)!, keys.get(b)!];
        if (!sameTitle(x.key, y.key)) continue;
        if (GENERIC_TITLES.has(x.key) && x.parentId !== y.parentId) continue;
        pairs.set(pairKey(a, b), a < b ? [a, b] : [b, a]);
      }
    }
  }
  return [...pairs.values()];
}
