/**
 * Ouverture, création et fermeture d'un fichier projet .nodal (§8).
 *
 * TODO(perf) : DatabaseSync est synchrone et s'exécute sur le thread du main
 * process. Acceptable pour le lot 1 ; si des opérations longues apparaissent
 * (import/export, indexation FTS, gros BLOB), déplacer l'accès SQLite dans un
 * utilityProcess ou un worker_thread.
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fromSystemError, NodalError } from '../../shared/errors';
import {
  assertSchemaSupported,
  getSchemaVersion,
  runMigrations,
} from './migrations';

/** "NODL" en ASCII : identifie un fichier Nodal dans l'en-tête SQLite. */
export const NODAL_APPLICATION_ID = 0x4e4f444c;

const BUSY_TIMEOUT_MS = 5000;
const SQLITE_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const;

export function getApplicationId(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA application_id').get() as
    | { application_id: number }
    | undefined;
  return row?.application_id ?? 0;
}

function configureConnection(db: DatabaseSync): void {
  // Un fichier ouvert peut provenir d'ailleurs : ne pas faire confiance aux
  // fonctions appelées depuis son schéma (triggers, vues).
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
  const row = db.prepare('PRAGMA journal_mode = WAL').get() as
    | { journal_mode: string }
    | undefined;
  if (row?.journal_mode.toLowerCase() !== 'wal') {
    throw new NodalError(
      'INVALID_WORKSPACE_FILE',
      "Impossible d'activer la journalisation WAL sur ce fichier.",
    );
  }
  db.exec('PRAGMA synchronous = NORMAL');
}

function openConnection(filePath: string): DatabaseSync {
  try {
    return new DatabaseSync(filePath, { enableForeignKeyConstraints: true });
  } catch (cause) {
    throw new NodalError(
      'INVALID_WORKSPACE_FILE',
      `Impossible d'ouvrir le fichier « ${filePath} ».`,
      { cause },
    );
  }
}

function safeClose(db: DatabaseSync): void {
  try {
    if (db.isOpen) db.close();
  } catch {
    // Déjà en erreur : on privilégie l'erreur d'origine.
  }
}

/**
 * Ouvre un fichier .nodal existant et applique les migrations manquantes.
 * Refuse un fichier SQLite étranger ou créé par une version plus récente,
 * sans rien y écrire.
 */
export function openNodalDatabase(filePath: string): DatabaseSync {
  if (!fs.existsSync(filePath)) {
    throw new NodalError(
      'FILE_NOT_FOUND',
      `Le fichier « ${filePath} » est introuvable.`,
    );
  }

  const db = openConnection(filePath);
  try {
    // Vérifications en lecture seule : aucune écriture avant d'être sûr que
    // le fichier est bien un fichier Nodal pris en charge.
    let applicationId: number;
    try {
      applicationId = getApplicationId(db);
    } catch (cause) {
      const known = fromSystemError(cause);
      if (known) throw known;
      throw new NodalError(
        'NOT_A_NODAL_FILE',
        "Ce fichier n'est pas un espace Nodal (base de données illisible).",
        { cause },
      );
    }
    if (applicationId !== NODAL_APPLICATION_ID) {
      throw new NodalError(
        'NOT_A_NODAL_FILE',
        "Ce fichier n'est pas un espace Nodal.",
      );
    }
    assertSchemaSupported(getSchemaVersion(db));

    configureConnection(db);
    runMigrations(db);
    return db;
  } catch (error) {
    safeClose(db);
    throw error;
  }
}

/**
 * Crée un nouveau fichier .nodal migré à la dernière version du schéma.
 * Le fichier ne doit pas exister : on n'écrase jamais un fichier existant.
 * En cas d'échec, le fichier partiellement créé est supprimé.
 */
export function createNodalDatabase(filePath: string): DatabaseSync {
  const existing = [
    filePath,
    ...SQLITE_SIDECAR_SUFFIXES.map((suffix) => filePath + suffix),
  ].find((candidate) => fs.existsSync(candidate));
  if (existing) {
    throw new NodalError(
      'FILE_ALREADY_EXISTS',
      `Le fichier « ${existing} » existe déjà. Choisissez un autre nom ou un autre emplacement.`,
    );
  }

  const db = openConnection(filePath);
  try {
    db.exec(`PRAGMA application_id = ${NODAL_APPLICATION_ID}`);
    configureConnection(db);
    runMigrations(db);
    return db;
  } catch (error) {
    safeClose(db);
    removeDatabaseFiles(filePath);
    throw error;
  }
}

/**
 * Fusionne le journal WAL dans le fichier principal puis ferme la connexion :
 * il ne reste qu'un seul fichier .nodal sur le disque.
 */
export function closeNodalDatabase(db: DatabaseSync): void {
  if (!db.isOpen) return;
  try {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // Après l'échec d'une écriture ayant déclenché l'index FTS5, la première
      // instruction suivante peut recevoir un SQLITE_LOCKED transitoire.
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    }
  } finally {
    db.close();
  }
}

function removeDatabaseFiles(filePath: string): void {
  for (const candidate of [
    filePath,
    ...SQLITE_SIDECAR_SUFFIXES.map((suffix) => filePath + suffix),
  ]) {
    fs.rmSync(candidate, { force: true });
  }
}

export function getSqliteVersion(): string {
  const db = new DatabaseSync(':memory:');
  try {
    const row = db.prepare('SELECT sqlite_version() AS version').get() as {
      version: string;
    };
    return row.version;
  } finally {
    db.close();
  }
}
