/**
 * Lecture d'un dossier Markdown / coffre Obsidian, sans accès disque :
 * front-matter (sous-ensemble de YAML, lu comme données), liens Obsidian
 * (`[[Note#Titre|texte]]`, `![[image.png]]`) et liens Markdown vers des
 * fichiers locaux, résolution des cibles dans le dossier. Logique pure.
 */
import path from 'node:path';
import { NODE_TYPES, type NodeType } from '../../shared/domain';
import { codeRanges } from '../../shared/wiki-links';

// --- Front-matter ------------------------------------------------------------

export interface FrontMatter {
  title: string | null;
  summary: string | null;
  nodeType: NodeType | null;
  tags: string[];
  aliases: string[];
}

const FRONT_MATTER =
  /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Sépare le bloc `---` de tête du reste du texte. */
export function splitFrontMatter(text: string): {
  yaml: string | null;
  body: string;
} {
  const match = FRONT_MATTER.exec(text);
  if (!match) return { yaml: null, body: text.replace(/^﻿/, '') };
  return { yaml: match[1] ?? '', body: text.slice(match[0].length) };
}

type YamlValue = string | string[];

const unquote = (value: string) => {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  // Commentaire en fin de ligne (hors guillemets).
  return trimmed.replace(/\s+#.*$/, '');
};

/**
 * Sous-ensemble de YAML suffisant pour un front-matter : `clé: valeur`,
 * listes `[a, b]` ou en lignes `- a`, blocs `|` et `>`. Le reste (objets
 * imbriqués, ancres, balises) est ignoré : rien n'est jamais interprété.
 */
export function parseSimpleYaml(yaml: string): Record<string, YamlValue> {
  const result: Record<string, YamlValue> = {};
  const lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]+(.*))?$/.exec(lines[i]!);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const raw = (match[2] ?? '').trim();
    // Lignes suivantes, plus indentées (liste ou bloc de texte).
    const nested: string[] = [];
    while (i + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[i + 1]!)) {
      nested.push(lines[++i]!);
    }
    if (raw.startsWith('[') && raw.endsWith(']')) {
      result[key] = raw
        .slice(1, -1)
        .split(',')
        .map(unquote)
        .filter((item) => item.length > 0);
    } else if (raw === '|' || raw === '>' || /^[|>][-+]?$/.test(raw)) {
      const text = nested.map((line) => line.trim());
      result[key] = (
        raw.startsWith('|') ? text.join('\n') : text.join(' ')
      ).trim();
    } else if (raw === '') {
      const items = nested
        .map((line) => /^\s*-\s+(.*)$/.exec(line)?.[1])
        .filter((item): item is string => item !== undefined)
        .map(unquote)
        .filter((item) => item.length > 0);
      if (items.length > 0) result[key] = items;
    } else {
      result[key] = unquote(raw);
    }
  }
  return result;
}

/** Libellés reconnus pour le type de nœud (anglais ou français, sans casse). */
const TYPE_ALIASES: Record<string, NodeType> = {
  composant: 'component',
  donnee: 'data',
  données: 'data',
  donnée: 'data',
  procédure: 'procedure',
  ressource: 'resource',
  générique: 'generic',
  generique: 'generic',
  fonction: 'function',
  méthode: 'function',
  methode: 'function',
  règle: 'rule',
  regle: 'rule',
  décision: 'decision',
  adr: 'decision',
  exigence: 'requirement',
  besoin: 'requirement',
  anomalie: 'issue',
  bogue: 'issue',
  bug: 'issue',
  tâche: 'task',
  tache: 'task',
  jalon: 'milestone',
  risque: 'risk',
  acteur: 'actor',
  personne: 'actor',
  équipe: 'actor',
  equipe: 'actor',
};

export function nodeTypeFrom(value: string): NodeType | null {
  const key = value.trim().toLocaleLowerCase('fr');
  if ((NODE_TYPES as readonly string[]).includes(key)) return key as NodeType;
  return TYPE_ALIASES[key] ?? null;
}

const asList = (value: YamlValue | undefined): string[] =>
  value === undefined
    ? []
    : Array.isArray(value)
      ? value
      : value.split(/[,\s]+/).filter((item) => item.length > 0);

const asText = (value: YamlValue | undefined): string | null => {
  const text = Array.isArray(value) ? value.join(', ') : value;
  return text && text.trim().length > 0 ? text.trim() : null;
};

/** Front-matter d'une note et texte qui suit. */
export function readFrontMatter(text: string): {
  meta: FrontMatter | null;
  body: string;
} {
  const { yaml, body } = splitFrontMatter(text);
  if (yaml === null) return { meta: null, body };
  const data = parseSimpleYaml(yaml);
  const typeValue = asText(data.type ?? data.nodetype ?? data['nodal-type']);
  return {
    meta: {
      title: asText(data.title),
      summary: asText(data.summary ?? data.description ?? data['résumé']),
      nodeType: typeValue ? nodeTypeFrom(typeValue) : null,
      tags: [
        ...new Set(
          asList(data.tags ?? data.tag)
            .map((tag) => tag.replace(/^#/, '').trim())
            .filter((tag) => tag.length > 0),
        ),
      ],
      aliases: asList(data.aliases ?? data.alias).map((alias) => alias.trim()),
    },
    body,
  };
}

// --- Liens -------------------------------------------------------------------

export interface VaultLink {
  start: number;
  end: number;
  /** `![[…]]` ou `![…](…)`. */
  embed: boolean;
  style: 'wiki' | 'markdown';
  /** Note ou fichier visé, sans `#titre` (chemin décodé pour un lien Markdown). */
  target: string;
  heading: string | null;
  /** Texte après `|`, ou texte du lien Markdown. */
  alias: string | null;
}

const WIKI = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const MARKDOWN = /(!?)\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function splitHeading(target: string): {
  target: string;
  heading: string | null;
} {
  const at = target.indexOf('#');
  if (at < 0) return { target: target.trim(), heading: null };
  const heading = target.slice(at + 1).trim();
  return { target: target.slice(0, at).trim(), heading: heading || null };
}

/** Liens Obsidian et liens Markdown locaux du texte, hors code, dans l'ordre. */
export function findVaultLinks(body: string): VaultLink[] {
  const ranges = codeRanges(body);
  const inCode = (at: number) =>
    ranges.some(([from, to]) => at >= from && at < to);
  const links: VaultLink[] = [];
  for (const match of body.matchAll(WIKI)) {
    if (inCode(match.index)) continue;
    // `\|` : barre échappée dans un tableau.
    const inner = match[2]!.replace(/\\\|/g, '|');
    const bar = inner.indexOf('|');
    const { target, heading } = splitHeading(
      bar < 0 ? inner : inner.slice(0, bar),
    );
    const alias = bar < 0 ? null : inner.slice(bar + 1).trim() || null;
    if (!target && !heading) continue;
    links.push({
      start: match.index,
      end: match.index + match[0].length,
      embed: match[1] === '!',
      style: 'wiki',
      target,
      heading,
      alias,
    });
  }
  for (const match of body.matchAll(MARKDOWN)) {
    if (inCode(match.index)) continue;
    const url = match[3]!;
    if (SCHEME.test(url) || url.startsWith('#') || url.startsWith('/')) {
      continue;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      decoded = url;
    }
    const { target, heading } = splitHeading(decoded);
    if (!target) continue;
    // Un lien Markdown à l'intérieur d'un lien [[…]] déjà relevé est ignoré.
    if (links.some((l) => match.index >= l.start && match.index < l.end)) {
      continue;
    }
    links.push({
      start: match.index,
      end: match.index + match[0].length,
      embed: match[1] === '!',
      style: 'markdown',
      target,
      heading,
      alias: match[2]!.trim() || null,
    });
  }
  return links.toSorted((a, b) => a.start - b.start);
}

/** Remplace chaque lien ; `replace` renvoie `null` pour garder le texte. */
export function rewriteVaultLinks(
  body: string,
  links: readonly VaultLink[],
  replace: (link: VaultLink) => string | null,
): string {
  let result = '';
  let at = 0;
  for (const link of links) {
    if (link.start < at) continue;
    const source = body.slice(link.start, link.end);
    result += body.slice(at, link.start) + (replace(link) ?? source);
    at = link.end;
  }
  return result + body.slice(at);
}

// --- Résolution --------------------------------------------------------------

export interface VaultNote {
  /** Chemin relatif au dossier importé, séparateurs `/`, avec `.md`. */
  path: string;
  title: string;
  aliases: readonly string[];
}

const lower = (value: string) => value.toLocaleLowerCase('fr');
const withoutMd = (value: string) => value.replace(/\.md$/i, '');

/** Chemin relatif normalisé ; `null` s'il sort du dossier. */
function joinInside(directory: string, target: string): string | null {
  const joined = path.posix.normalize(path.posix.join(directory, target));
  return joined.startsWith('../') || joined === '..' ? null : joined;
}

/** Parmi plusieurs candidats : celui du dossier de la note, sinon le moins profond. */
function closest<T>(
  candidates: T[],
  pathOf: (item: T) => string,
  from: string,
): T | null {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const directory = path.posix.dirname(from);
  const sameFolder = candidates.find(
    (item) => path.posix.dirname(pathOf(item)) === directory,
  );
  if (sameFolder) return sameFolder;
  return candidates.toSorted(
    (a, b) => pathOf(a).split('/').length - pathOf(b).split('/').length,
  )[0]!;
}

/**
 * Résout les cibles des liens comme Obsidian : chemin relatif à la note,
 * chemin depuis la racine du dossier, puis nom seul (le plus proche de la
 * note l'emporte), et enfin alias ou titre du front-matter.
 */
export function createVaultResolver<N extends VaultNote>(
  notes: readonly N[],
  files: readonly string[],
) {
  const notesByPath = new Map(notes.map((note) => [lower(note.path), note]));
  const filesByPath = new Map(files.map((file) => [lower(file), file]));

  return {
    /** Note visée par `target` depuis la note `from`, ou `null`. */
    note(target: string, from: string): N | null {
      const wanted = withoutMd(target.trim());
      if (!wanted) return null;
      const directory = path.posix.dirname(from);
      for (const candidate of [
        joinInside(directory, wanted),
        joinInside('', wanted),
      ]) {
        const found = candidate && notesByPath.get(lower(`${candidate}.md`));
        if (found) return found;
      }
      const suffix = `/${lower(wanted)}.md`;
      const byName = notes.filter(
        (note) =>
          lower(note.path) === suffix.slice(1) ||
          lower(note.path).endsWith(suffix),
      );
      if (byName.length > 0) return closest(byName, (note) => note.path, from);
      const key = lower(wanted);
      return (
        closest(
          notes.filter(
            (note) =>
              lower(note.title) === key ||
              note.aliases.some((alias) => lower(alias) === key),
          ),
          (note) => note.path,
          from,
        ) ?? null
      );
    },

    /** Fichier (pièce jointe) visé depuis la note `from`, ou `null`. */
    file(target: string, from: string): string | null {
      const directory = path.posix.dirname(from);
      for (const candidate of [
        joinInside(directory, target),
        joinInside('', target),
      ]) {
        const found = candidate && filesByPath.get(lower(candidate));
        if (found) return found;
      }
      const name = lower(path.posix.basename(target));
      return closest(
        files.filter((file) => lower(path.posix.basename(file)) === name),
        (file) => file,
        from,
      );
    },
  };
}
