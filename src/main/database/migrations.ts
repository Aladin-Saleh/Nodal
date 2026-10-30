import type { DatabaseSync } from 'node:sqlite';
import { NodalError } from '../../shared/errors';
import { migration001 } from './migrations/001-initial-schema';
import { migration002 } from './migrations/002-node-position-z';
import { migration003 } from './migrations/003-search-index';
import { migration004 } from './migrations/004-assistant-changes';
import { inTransaction } from './transaction';

export interface Migration {
  /** Valeur de PRAGMA user_version une fois la migration appliquée. */
  version: number;
  name: string;
  sql: string;
}

/** Liste ordonnée, versions contiguës à partir de 1. */
export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length;

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as
    | { user_version: number }
    | undefined;
  return row?.user_version ?? 0;
}

export function assertSchemaSupported(
  version: number,
  latest: number = LATEST_SCHEMA_VERSION,
): void {
  if (version > latest) {
    throw new NodalError(
      'SCHEMA_TOO_NEW',
      `Ce fichier a été créé par une version plus récente de Nodal (schéma ${version}, ` +
        `cette version gère jusqu'au schéma ${latest}). Mettez Nodal à jour pour l'ouvrir.`,
    );
  }
}

/**
 * Applique les migrations manquantes, chacune dans sa propre transaction :
 * en cas d'échec, le fichier reste à la dernière version cohérente.
 * Retourne la version finale du schéma.
 */
export function runMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[] = MIGRATIONS,
): number {
  const current = getSchemaVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  assertSchemaSupported(current, latest);

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    try {
      inTransaction(db, () => {
        db.exec(migration.sql);
        // user_version fait partie de l'en-tête : il est annulé avec la transaction.
        db.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
      });
    } catch (cause) {
      throw new NodalError(
        'MIGRATION_FAILED',
        `La mise à jour du fichier vers le schéma ${migration.version} (${migration.name}) a échoué.`,
        { cause },
      );
    }
  }
  return getSchemaVersion(db);
}
