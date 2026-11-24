/**
 * Vérifie qu'une citation figure bien dans le fichier du code qu'elle cite.
 * Lecture seule, jamais hors des dossiers de code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePath, toRootRelative } from '../../shared/code-anchors';

const MAX_BYTES = 2 * 1024 * 1024;
/** En dessous, une citation se retrouve partout : elle ne prouve rien. */
const QUOTE_MIN_LENGTH = 8;

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Fichier réel dans un dossier de code, liens symboliques résolus. */
function fileInRoot(root: string, relative: string): string | null {
  try {
    const base = fs.realpathSync(root);
    const file = fs.realpathSync(path.join(base, ...relative.split('/')));
    const inside = path.relative(base, file);
    if (inside.startsWith('..') || path.isAbsolute(inside)) return null;
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_BYTES ? file : null;
  } catch {
    return null;
  }
}

/**
 * `true` : la citation est dans le fichier (aux espaces près) ; `false` : le
 * fichier existe mais ne la contient pas ; `null` : pas vérifiable (pas de
 * citation, source qui n'est pas un fichier des dossiers de code).
 */
export function verifyQuote(
  roots: readonly string[],
  source: string,
  quote: string | null,
  caseInsensitive: boolean,
): boolean | null {
  const wanted = collapse(quote ?? '');
  if (wanted.length < QUOTE_MIN_LENGTH) return null;
  // « fichier.ts:12 », « fichier.ts:12-20 », « fichier.ts#L12 ».
  const name = source.trim().replace(/(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$/, '');
  const found = toRootRelative(name, roots, caseInsensitive);
  if (!found?.path || found.path.split('/').includes('..')) return null;
  const candidates = isAbsolutePath(name) ? [found.root!] : roots;
  for (const root of candidates) {
    const file = fileInRoot(root, found.path);
    if (!file) continue;
    try {
      return collapse(fs.readFileSync(file, 'utf8')).includes(wanted);
    } catch {
      return null;
    }
  }
  return null;
}
