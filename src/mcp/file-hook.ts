/**
 * Rappel avant de lire ou de modifier un fichier ancré (hook `PreToolUse` de
 * Claude Code) : les nœuds qui documentent ce fichier, résumé et titres des
 * documents, une fois par session et par agent (context-session.ts). L'appel
 * d'outil n'est jamais bloqué ni modifié.
 */
import fs from 'node:fs';
import path from 'node:path';
import { staticPrefix, toRootRelative } from '../shared/code-anchors';
import {
  PATHS_CASE_INSENSITIVE,
  nodesForPaths,
  type AnchoredNode,
} from '../main/knowledge/anchor-service';
import { asRows } from '../main/knowledge/rows';
import { codeRootsFor, nodePaths } from './tools';
import type { ReadContext } from './workspace-reader';

/** Nœuds rappelés au plus par appel d'outil. */
export const FILE_HOOK_MAX_NODES = 3;
/** Mots examinés au plus dans une commande. */
const MAX_COMMAND_FILES = 50;

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/** Chemin de Git Bash (`/c/dossier`) en chemin Windows. */
const fromGitBash = (value: string) =>
  process.platform === 'win32'
    ? value.replace(/^\/([a-z])(?=\/|$)/i, '$1:')
    : value;

/**
 * Chemins possibles des fichiers cités par une commande (tout mot avec une
 * extension), relatifs au dossier courant ou à un dossier où elle se place
 * (`cd`). Le texte d'un heredoc est ignoré. Ce n'est pas un interpréteur : un
 * chemin n'est retenu ensuite que s'il désigne un fichier existant.
 */
function commandFiles(command: string, cwd: string): string[] {
  const words = command
    .split('<<')[0]!
    .split(/[\s"'`;|&<>()]+/)
    .filter(Boolean)
    .map(fromGitBash);
  const bases = [cwd];
  words.forEach((word, index) => {
    if (words[index - 1] === 'cd')
      bases.push(path.resolve(bases.at(-1)!, word));
  });
  return words
    .filter((word) => /\.\w{1,8}$/.test(word) && !/[$*?{}]|:\/\//.test(word))
    .slice(0, MAX_COMMAND_FILES)
    .flatMap((word) => bases.map((base) => path.resolve(base, word)));
}

/**
 * Fichiers (chemins absolus) visés par un appel d'outil ; vide si aucun.
 * Claude Code : `file_path` (Read, Edit, Write), `notebook_path`, ou `command`
 * d'un terminal, où se fait en pratique une grande partie des lectures.
 */
export function toolFiles(input: unknown, cwd: string): string[] {
  if (typeof input !== 'object' || input === null) return [];
  const { file_path, notebook_path, command } = input as Record<
    string,
    unknown
  >;
  if (isString(file_path)) return [path.resolve(cwd, file_path)];
  if (isString(notebook_path)) return [path.resolve(cwd, notebook_path)];
  if (!isString(command)) return [];
  return commandFiles(command, cwd).filter((file) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

/** Précision des motifs qui couvrent ces fichiers : le fichier lui-même d'abord. */
function precision(node: AnchoredNode, files: readonly string[]): number {
  return Math.max(
    ...node.patterns.map((pattern) => {
      if (files.includes(pattern)) return Number.POSITIVE_INFINITY;
      const prefix = staticPrefix(pattern);
      return files.some((file) => file.startsWith(prefix)) ? prefix.length : -1;
    }),
  );
}

/** Nœud rappelé : ses documents sont cités, à lire au besoin. */
export interface FileNode {
  id: string;
  path: string;
  summary: string | null;
  documents: string;
}

/**
 * Nœuds ancrés à ces fichiers, les plus précis d'abord, avec les chemins
 * relatifs concernés. `keep` écarte ceux déjà donnés dans la session.
 */
export function fileNodes(
  ctx: ReadContext,
  workspaceFile: string,
  files: readonly string[],
  projectRoot: string | null,
  keep: (nodeId: string) => boolean,
): { files: string[]; nodes: FileNode[] } {
  const roots = codeRootsFor(ctx, workspaceFile, projectRoot);
  const relative = files.flatMap((file) => {
    const found = toRootRelative(file, roots, PATHS_CASE_INSENSITIVE);
    return found?.root && found.path ? [found.path] : [];
  });
  const matches = nodesForPaths(ctx, [...new Set(relative)])
    .map((match) => ({ ...match, rank: precision(match.node, match.paths) }))
    .toSorted((a, b) => b.rank - a.rank)
    .slice(0, FILE_HOOK_MAX_NODES)
    // Après la limite : un nœud déjà donné n'est pas remplacé par un nœud
    // plus général.
    .filter(({ node }) => keep(node.nodeId));
  if (matches.length === 0) return { files: [], nodes: [] };

  const pathOf = nodePaths(ctx);
  const summaryOf = ctx.db.prepare('SELECT summary FROM node WHERE id = ?');
  const documentsOf = ctx.db.prepare(
    'SELECT title FROM document WHERE node_id = ? ORDER BY sort_order, rowid',
  );
  return {
    files: [...new Set(matches.flatMap((match) => match.paths))],
    nodes: matches.map(({ node }) => ({
      id: node.nodeId,
      path: pathOf(node.nodeId),
      summary:
        (summaryOf.get(node.nodeId) as { summary: string | null } | undefined)
          ?.summary ?? null,
      documents: asRows<{ title: string }>(documentsOf.all(node.nodeId))
        .map((doc) => doc.title)
        .join(' ; '),
    })),
  };
}
