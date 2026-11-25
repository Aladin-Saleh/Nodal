/**
 * Empreinte du contenu d'un fichier du code : dit si un fichier a changé,
 * là où sa date ne dit que s'il a été réécrit (changement de branche, copie
 * du dépôt, enregistrement sans modification). La mise en forme ne compte pas
 * (espaces, retours à la ligne, guillemets, dernier séparateur), ni l'en-tête
 * YAML d'un fichier Markdown.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Au-delà, le contenu n'est pas normalisé. */
const NORMALIZE_MAX_BYTES = 2 * 1024 * 1024;
/**
 * Granularité des dates de modification (2 s sur FAT) : une empreinte lue
 * trop près de l'écriture ne peut pas être reprise sur la foi de la date.
 */
const MTIME_GRANULARITY_MS = 2_000;
const CACHE_MAX_ENTRIES = 20_000;

/** Langages où l'indentation a un sens : seules les fins de ligne sont ignorées. */
const INDENTED = /\.(?:py|pyi|ya?ml|sass|pug|haml|hs|fs|coffee|nim)$/i;

function normalizeContent(text: string, fileName: string): string {
  const body = /\.mdx?$/i.test(fileName)
    ? text.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    : text;
  if (INDENTED.test(fileName)) {
    return body
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .join('\n');
  }
  return (
    body
      .replace(/["'`]/g, '"')
      .replace(/\s+/g, ' ')
      // Seul un espace entre deux mots les sépare.
      .replace(/ (?=\W|$)|(?<=\W|^) /g, '')
      // Dernier séparateur, et `|` initial d'une union de types.
      .replace(/[,;](?=[)\]}])/g, '')
      .replace(/(?<=[=:(<,])\|(?!\|)/g, '')
      .replace(/\bas\|(?!\|)/g, 'as ')
  );
}

const digest = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex').slice(0, 32);

/** Empreinte d'un contenu ; un fichier binaire n'est pas normalisé. */
export function contentFingerprint(content: Buffer, fileName: string): string {
  return content.length > NORMALIZE_MAX_BYTES || content.includes(0)
    ? digest(content)
    : digest(normalizeContent(content.toString('utf8'), fileName));
}

interface CachedFingerprint {
  size: number;
  mtimeMs: number;
  /** Change même si la date de modification est remise à l'ancienne. */
  ctimeMs: number;
  /** Heure de la lecture, prise avant elle. */
  readAt: number;
  fingerprint: string;
}

const cache = new Map<string, CachedFingerprint>();

/** Empreinte d'un fichier ; `null` s'il manque ou n'est pas lisible. */
export async function fileFingerprint(file: string): Promise<string | null> {
  try {
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile()) return null;
    const known = cache.get(file);
    if (
      known &&
      known.size === stat.size &&
      known.mtimeMs === stat.mtimeMs &&
      known.ctimeMs === stat.ctimeMs &&
      Math.max(known.mtimeMs, known.ctimeMs) + MTIME_GRANULARITY_MS <=
        known.readAt
    ) {
      return known.fingerprint;
    }
    const readAt = Date.now();
    const fingerprint = contentFingerprint(
      await fs.promises.readFile(file),
      path.basename(file),
    );
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
    cache.set(file, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      readAt,
      fingerprint,
    });
    return fingerprint;
  } catch {
    return null;
  }
}

/** Comme fileFingerprint, sans attendre ni cache (quelques fichiers). */
export function fileFingerprintSync(file: string): string | null {
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    return contentFingerprint(fs.readFileSync(file), path.basename(file));
  } catch {
    return null;
  }
}

/**
 * Le fichier a-t-il exactement le contenu d'un objet git (aux fins de ligne
 * près) ? Calculé ici : aucun processus git par fichier.
 */
export async function matchesGitBlob(
  file: string,
  objectId: string,
): Promise<boolean> {
  const algorithm = objectId.length === 64 ? 'sha256' : 'sha1';
  const idOf = (content: Buffer) =>
    createHash(algorithm)
      .update(`blob ${content.length}\0`)
      .update(content)
      .digest('hex');
  try {
    const content = await fs.promises.readFile(file);
    if (idOf(content) === objectId) return true;
    if (!content.includes('\r\n')) return false;
    const unix = content.toString('latin1').replaceAll('\r\n', '\n');
    return idOf(Buffer.from(unix, 'latin1')) === objectId;
  } catch {
    return false;
  }
}
