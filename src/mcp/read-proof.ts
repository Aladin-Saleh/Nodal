/**
 * Preuve de lecture : le hook `PreToolUse` note les fichiers ancrés que
 * l'assistant lit (avec l'empreinte de leur contenu) ou modifie. Quand il met
 * ensuite un nœud à jour, le serveur sait quels fichiers il avait vus dans
 * leur état actuel (snapshotsAfterWrite). Journal temporaire par espace, en
 * ajout seul : plusieurs hooks y écrivent en même temps. Sans contenu.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Une lecture plus ancienne ne prouve plus rien. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Une modification annoncée a lieu dans ce délai (accord de l'utilisateur). */
const EDIT_DELAY_MS = 10 * 60 * 1000;
const MAX_LOG_BYTES = 1024 * 1024;

interface ReadEntry {
  /** Fichier (empreinte du chemin absolu). */
  file: string;
  at: number;
  /** Empreinte du contenu lu ; `null` : le fichier va être modifié. */
  content: string | null;
}

const hash = (text: string) =>
  createHash('sha256').update(text).digest('hex').slice(0, 32);

const fileKey = (file: string) =>
  hash(
    process.platform === 'win32' || process.platform === 'darwin'
      ? path.resolve(file).toLowerCase()
      : path.resolve(file),
  );

export function readLogFile(workspaceFile: string): string {
  return path.join(
    os.tmpdir(),
    'nodal-context',
    `reads-${fileKey(workspaceFile)}.jsonl`,
  );
}

/** Note des fichiers lus (`content`) ou sur le point d'être modifiés (`null`). */
export function recordReads(
  workspaceFile: string,
  reads: readonly { file: string; content: string | null }[],
): void {
  if (reads.length === 0) return;
  const log = readLogFile(workspaceFile);
  try {
    fs.mkdirSync(path.dirname(log), { recursive: true });
    const size = fs.statSync(log, { throwIfNoEntry: false })?.size ?? 0;
    // Trop gros : repartir de zéro, au pire des fichiers seront à redéclarer.
    if (size > MAX_LOG_BYTES) fs.rmSync(log, { force: true });
    const at = Date.now();
    fs.appendFileSync(
      log,
      reads
        .map(({ file, content }) => {
          const entry: ReadEntry = { file: fileKey(file), at, content };
          return `${JSON.stringify(entry)}\n`;
        })
        .join(''),
    );
  } catch {
    // Journal facultatif.
  }
}

/** Fichier tel qu'il est maintenant. */
export interface CurrentFile {
  absolute: string;
  fingerprint: string | null;
  mtime: Date;
}

/** Dit si un assistant a lu ou écrit un fichier dans son état actuel. */
export function provenReads(
  workspaceFile: string,
): (file: CurrentFile) => boolean {
  const entries = new Map<string, ReadEntry[]>();
  let text = '';
  try {
    text = fs.readFileSync(readLogFile(workspaceFile), 'utf8');
  } catch {
    // Hook non installé, ou rien de lu.
  }
  const oldest = Date.now() - MAX_AGE_MS;
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as ReadEntry;
      if (!(entry.at >= oldest)) continue;
      const list = entries.get(entry.file);
      if (list) list.push(entry);
      else entries.set(entry.file, [entry]);
    } catch {
      // Ligne coupée par une écriture simultanée.
    }
  }
  return ({ absolute, fingerprint, mtime }) =>
    fingerprint !== null &&
    (entries.get(fileKey(absolute)) ?? []).some((entry) =>
      entry.content === null
        ? mtime.getTime() >= entry.at &&
          mtime.getTime() <= entry.at + EDIT_DELAY_MS
        : entry.content === fingerprint,
    );
}
