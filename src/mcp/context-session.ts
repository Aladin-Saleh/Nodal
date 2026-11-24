/**
 * Ce que le contexte automatique a déjà donné à une session d'assistant, pour
 * ne pas répéter les mêmes nœuds à chaque demande. Fichier temporaire par
 * session (jamais dans la base), sans contenu : identifiants et dates de
 * modification. Un échec d'écriture n'a pour effet que de répéter.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Demandes après lesquelles un nœud peut être redonné : l'assistant a pu
 * l'oublier (contexte résumé), ce que le hook ne sait pas.
 */
export const REPEAT_AFTER_PROMPTS = 10;
/** Âge au-delà duquel le fichier d'une session est effacé. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface SentNode {
  /** Date de modification du nœud et de ses documents quand il a été donné. */
  version: string;
  /** Donné avec ses documents, pas seulement son résumé. */
  full: boolean;
  /** Numéro de la demande. */
  prompt: number;
}

export interface ContextSession {
  prompt: number;
  sent: Record<string, SentNode>;
}

/** Fichier d'une session ; ni l'identifiant ni l'espace ne sont lisibles. */
export function contextSessionFile(
  sessionId: string,
  workspaceFile: string,
): string {
  const key = createHash('sha256')
    .update(`${sessionId}\0${workspaceFile}`)
    .digest('hex')
    .slice(0, 32);
  return path.join(os.tmpdir(), 'nodal-context', `${key}.json`);
}

export function readContextSession(file: string): ContextSession {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as ContextSession;
    if (
      Number.isInteger(value.prompt) &&
      typeof value.sent === 'object' &&
      value.sent !== null
    ) {
      return value;
    }
  } catch {
    // Première demande de la session, ou fichier illisible.
  }
  return { prompt: 0, sent: {} };
}

function removeOldSessions(folder: string): void {
  for (const name of fs.readdirSync(folder)) {
    const target = path.join(folder, name);
    try {
      if (Date.now() - fs.statSync(target).mtimeMs > MAX_AGE_MS)
        fs.rmSync(target, { force: true });
    } catch {
      // Effacé entre-temps : rien à faire.
    }
  }
}

export function writeContextSession(
  file: string,
  session: ContextSession,
): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(session));
    fs.renameSync(temporary, file);
    if (session.prompt === 1) removeOldSessions(path.dirname(file));
  } catch {
    fs.rmSync(temporary, { force: true });
  }
}

/** Déjà donné récemment, aussi complètement, et inchangé depuis. */
export function alreadySent(
  session: ContextSession,
  nodeId: string,
  version: string,
  full: boolean,
): boolean {
  const sent = session.sent[nodeId];
  return (
    sent !== undefined &&
    sent.version === version &&
    (sent.full || !full) &&
    session.prompt - sent.prompt < REPEAT_AFTER_PROMPTS
  );
}
