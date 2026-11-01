/**
 * Fichiers ancrés et documentation possiblement obsolète, sur le disque
 * (lecture seule). Utilisé par l'application et le serveur MCP, hors de
 * toute connexion à la base : les nœuds ancrés sont lus avant.
 *
 * Un fichier compte comme modifié depuis la date de référence d'un nœud si :
 * - dossier sous git : un commit postérieur le touche ET sa date de
 *   modification est elle aussi postérieure (ou il a été supprimé). Sans la
 *   seconde condition, le cas courant « modifier le code, mettre la
 *   documentation à jour, puis committer » signalerait à tort le nœud ;
 * - sinon : sa date de modification est postérieure.
 */
import path from 'node:path';
import type {
  AnchorFiles,
  ChangedFile,
  StaleNode,
} from '../../shared/code-anchors';
import type { AnchoredNode } from '../knowledge/anchor-service';
import { PATHS_CASE_INSENSITIVE } from '../knowledge/anchor-service';
import {
  isDirectory,
  modifiedAt,
  scanPattern,
  type PatternFiles,
} from './file-scan';
import {
  filesCommittedSince,
  isGitWorkTree,
  runGit,
  type GitRunner,
} from './git-history';

/** Fichiers modifiés listés au plus par nœud (le compte reste exact). */
export const STALE_FILES_LIMIT = 20;
/** Fichiers listés au plus par motif dans le panneau du nœud. */
export const ANCHOR_FILES_LIMIT = 50;
/** Vérifications de nœuds menées en parallèle. */
const CONCURRENCY = 4;

export interface CodeCheckOptions {
  run?: GitRunner;
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** Dossiers de code qui existent (les autres sont ignorés). */
async function existingRoots(roots: readonly string[]): Promise<string[]> {
  const checks = await Promise.all(roots.map((root) => isDirectory(root)));
  return roots.filter((_, index) => checks[index]);
}

/** Fichiers modifiés depuis `since` dans un dossier, pour des motifs. */
async function changedInRoot(
  root: string,
  patterns: readonly string[],
  since: Date,
  git: boolean,
  run: GitRunner,
): Promise<ChangedFile[]> {
  const changed: ChangedFile[] = [];
  if (git) {
    const committed = await filesCommittedSince(root, patterns, since, run);
    for (const [file, changedAt] of committed) {
      const mtime = await modifiedAt(root, file);
      if (mtime === null)
        changed.push({ path: file, changedAt, deleted: true });
      else if (mtime > since) changed.push({ path: file, changedAt });
    }
    return changed;
  }
  for (const pattern of patterns) {
    const { files } = await scanPattern(root, pattern, {
      caseInsensitive: PATHS_CASE_INSENSITIVE,
      limit: Number.POSITIVE_INFINITY,
    });
    for (const file of files) {
      const mtime = await modifiedAt(root, file);
      if (mtime && mtime > since) {
        changed.push({ path: file, changedAt: mtime.toISOString() });
      }
    }
  }
  return changed;
}

/**
 * Nœuds dont un fichier ancré a changé depuis leur date de référence.
 * `roots` : dossiers de code absolus. Un dossier sans git (ou git absent)
 * se rabat sur les dates de modification.
 */
export async function findStaleNodes(
  roots: readonly string[],
  nodes: readonly AnchoredNode[],
  options: CodeCheckOptions = {},
): Promise<StaleNode[]> {
  const run = options.run ?? runGit;
  if (nodes.length === 0) return [];
  const usable = await existingRoots(roots);
  if (usable.length === 0) return [];
  const gitRoots = new Map<string, boolean>();
  await Promise.all(
    usable.map(async (root) =>
      gitRoots.set(root, await isGitWorkTree(root, run)),
    ),
  );

  const results = await mapLimited(nodes, CONCURRENCY, async (node) => {
    const since = new Date(node.since);
    if (Number.isNaN(since.getTime())) return null;
    const byPath = new Map<string, ChangedFile>();
    const multiple = usable.length > 1;
    for (const root of usable) {
      let files: ChangedFile[];
      try {
        files = await changedInRoot(
          root,
          node.patterns,
          since,
          gitRoots.get(root) ?? false,
          run,
        );
      } catch {
        // git en échec (délai dépassé…) : ce dossier est ignoré cette fois.
        continue;
      }
      for (const file of files) {
        // Plusieurs dossiers : le nom du dossier distingue les chemins.
        const shown = multiple
          ? `${path.basename(root)}/${file.path}`
          : file.path;
        byPath.set(shown, { ...file, path: shown });
      }
    }
    if (byPath.size === 0) return null;
    const files = [...byPath.values()].toSorted((a, b) =>
      b.changedAt.localeCompare(a.changedAt),
    );
    const anyGit = usable.some((root) => gitRoots.get(root));
    return {
      nodeId: node.nodeId,
      since: node.since,
      files: files.slice(0, STALE_FILES_LIMIT),
      fileCount: files.length,
      source: anyGit ? 'git' : 'mtime',
    } satisfies StaleNode;
  });
  return results.filter((item): item is StaleNode => item !== null);
}

/** Fichiers couverts par chaque motif d'un nœud, tous dossiers confondus. */
export async function describeAnchors(
  roots: readonly string[],
  patterns: readonly string[],
): Promise<AnchorFiles[]> {
  const usable = await existingRoots(roots);
  const multiple = usable.length > 1;
  return Promise.all(
    patterns.map(async (pattern) => {
      const perRoot: PatternFiles[] = await Promise.all(
        usable.map((root) =>
          scanPattern(root, pattern, {
            caseInsensitive: PATHS_CASE_INSENSITIVE,
            limit: ANCHOR_FILES_LIMIT,
          }),
        ),
      );
      const files = perRoot
        .flatMap((result, index) =>
          result.files.map((file) =>
            multiple ? `${path.basename(usable[index]!)}/${file}` : file,
          ),
        )
        .slice(0, ANCHOR_FILES_LIMIT);
      return {
        pattern,
        files,
        count: perRoot.reduce((sum, result) => sum + result.count, 0),
        truncated: perRoot.some((result) => result.truncated),
      };
    }),
  );
}
