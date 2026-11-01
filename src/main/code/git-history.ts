/**
 * Historique git d'un dossier de code, en lecture seule.
 *
 * Choix : `execFile` de l'exécutable git plutôt qu'une bibliothèque JS
 * (isomorphic-git). Mesuré sur un dépôt de 533 commits : 20 ms par appel
 * quelle que soit l'ancienneté du fichier, contre 460 ms pour un fichier
 * ancien avec isomorphic-git (parcours de tout l'historique en JS), qui
 * pèserait aussi 8,5 Mo (55 paquets) dans l'application et le serveur MCP,
 * sans motifs glob. Si git est absent, l'appelant se rabat sur les dates de
 * modification des fichiers.
 *
 * Sécurité :
 * - jamais de shell : `execFile`, arguments fixes, motifs validés
 *   (normalizeAnchorPattern) et placés après `--` ;
 * - exécutable cherché dans les dossiers absolus du PATH seulement : sous
 *   Windows, un nom nu serait d'abord cherché dans le dossier courant, donc
 *   un `git.exe` déposé dans le dépôt serait exécuté ;
 * - commandes en lecture seule (`rev-parse`, `log`) avec
 *   GIT_OPTIONAL_LOCKS=0 (aucun verrou ni rafraîchissement de l'index),
 *   sans pager, fsmonitor ni invite d'identifiants ; délai maximal.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const GIT_TIMEOUT_MS = 5000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
/** Séparateur de commits dans la sortie de `git log`. */
const RECORD = '\u001e';

/** Exécute git dans `cwd` ; rejette si git échoue ou dépasse le délai. */
export type GitRunner = (cwd: string, args: string[]) => Promise<string>;

let cachedGit: string | null | undefined;

/** Chemin absolu de l'exécutable git ; `null` s'il est introuvable. */
export function findGitExecutable(
  envPath = process.env.PATH ?? '',
  platform = process.platform,
): string | null {
  const names = platform === 'win32' ? ['git.exe'] : ['git'];
  for (const directory of envPath.split(path.delimiter)) {
    // Un dossier relatif du PATH dépendrait du dossier courant.
    if (!directory || !path.isAbsolute(directory)) continue;
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // Absent de ce dossier.
      }
    }
  }
  return null;
}

/** Lance git (introuvable : rejet avec `code: 'ENOENT'`). */
export const runGit: GitRunner = (cwd, args) => {
  if (cachedGit === undefined) cachedGit = findGitExecutable();
  const git = cachedGit;
  if (!git) {
    return Promise.reject(
      Object.assign(new Error('git introuvable'), { code: 'ENOENT' }),
    );
  }
  return new Promise((resolve, reject) => {
    execFile(
      git,
      [
        '--no-pager',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.quotepath=false',
        ...args,
      ],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
          GIT_PAGER: '',
          LC_ALL: 'C',
        },
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
};

/** Le dossier est-il dans un dépôt git (et git disponible) ? */
export async function isGitWorkTree(
  root: string,
  run: GitRunner = runGit,
): Promise<boolean> {
  try {
    const out = await run(root, ['rev-parse', '--is-inside-work-tree']);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Fichiers touchés par des commits postérieurs à `since`, avec la date du
 * plus récent : chemin relatif au dossier `root` → date ISO. Les motifs sont
 * passés en pathspecs `:(glob)` (même syntaxe que l'ancrage).
 */
export async function filesCommittedSince(
  root: string,
  patterns: readonly string[],
  since: Date,
  run: GitRunner = runGit,
): Promise<Map<string, string>> {
  const out = await run(root, [
    'log',
    `--since=${since.toISOString()}`,
    `--format=${RECORD}%cI`,
    '--name-only',
    '--relative',
    '--no-renames',
    '-z',
    '--',
    ...patterns.map((pattern) => `:(glob)${pattern}`),
  ]);
  const changes = new Map<string, string>();
  for (const record of out.split(RECORD)) {
    const [date, ...files] = record
      .split(/[\0\n]/)
      .filter((part) => part.length > 0);
    if (!date) continue;
    const at = new Date(date);
    // --since est à la seconde près : la comparaison exacte se fait ici.
    if (Number.isNaN(at.getTime()) || at <= since) continue;
    // Du plus récent au plus ancien : la première date vue est la bonne.
    for (const file of files) {
      if (!changes.has(file)) changes.set(file, at.toISOString());
    }
  }
  return changes;
}
