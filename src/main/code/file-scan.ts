/**
 * Fichiers d'un dossier de code couverts par des motifs d'ancrage. Lecture
 * seule ; les liens symboliques ne sont jamais suivis (ni dossiers ni
 * fichiers) et les dossiers lourds sans intérêt (.git, node_modules) sont
 * ignorés. Chaque motif n'est parcouru qu'à partir de sa partie fixe.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  isGlobPattern,
  anchorRegExp,
  staticPrefix,
} from '../../shared/code-anchors';

/** Dossiers jamais parcourus. */
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules']);
/** Entrées examinées au plus par parcours (garde-fou des motifs larges). */
export const SCAN_MAX_ENTRIES = 50_000;

export interface ScanOptions {
  caseInsensitive: boolean;
  /** Fichiers renvoyés au plus par motif (le compte reste exact). */
  limit: number;
}

export interface PatternFiles {
  pattern: string;
  /** Chemins relatifs (séparateurs `/`), triés, plafonnés à `limit`. */
  files: string[];
  /** Nombre de fichiers trouvés ; `truncated` si le parcours a été borné. */
  count: number;
  truncated: boolean;
}

const toPosix = (relative: string) => relative.split(path.sep).join('/');

async function lstat(target: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.lstat(target);
  } catch {
    return null;
  }
}

/** Fichiers d'un motif, relatifs à `root` (dossier absolu existant). */
export async function scanPattern(
  root: string,
  pattern: string,
  options: ScanOptions,
): Promise<PatternFiles> {
  const prefix = staticPrefix(pattern);
  const start = prefix ? path.join(root, ...prefix.split('/')) : root;
  const files: string[] = [];
  let count = 0;
  let visited = 0;
  let truncated = false;
  const regExp = anchorRegExp(pattern, options.caseInsensitive);
  const found = (relative: string) => {
    count++;
    if (files.length < options.limit) files.push(relative);
  };

  const startStat = await lstat(start);
  if (!startStat || startStat.isSymbolicLink()) {
    return { pattern, files, count, truncated };
  }
  if (startStat.isFile()) {
    if (!isGlobPattern(pattern) || regExp.test(prefix)) found(prefix);
    return { pattern, files, count, truncated };
  }

  const queue = [start];
  while (queue.length > 0) {
    const directory = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      continue; // Dossier illisible : ignoré.
    }
    for (const entry of entries) {
      if (++visited > SCAN_MAX_ENTRIES) {
        truncated = true;
        queue.length = 0;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) queue.push(full);
      } else if (entry.isFile()) {
        const relative = toPosix(path.relative(root, full));
        if (regExp.test(relative)) found(relative);
      }
    }
  }
  files.sort();
  return { pattern, files, count, truncated };
}

/** Le chemin est-il un dossier existant (et pas un lien symbolique) ? */
export async function isDirectory(target: string): Promise<boolean> {
  const stat = await lstat(target);
  return stat !== null && stat.isDirectory();
}

/** Date de modification d'un fichier relatif à `root` ; `null` s'il manque. */
export async function modifiedAt(
  root: string,
  relative: string,
): Promise<Date | null> {
  const stat = await lstat(path.join(root, ...relative.split('/')));
  return stat && stat.isFile() ? stat.mtime : null;
}
