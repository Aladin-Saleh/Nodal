import type { DatabaseSync } from 'node:sqlite';
import { NodalError } from '../../shared/errors';
import { migration001 } from './migrations/001-initial-schema';
import { migration002 } from './migrations/002-node-position-z';
import { migration003 } from './migrations/003-search-index';
import { migration004 } from './migrations/004-assistant-changes';
import { migration005 } from './migrations/005-assistant-validation';
import { migration006 } from './migrations/006-graph-views';
import { migration007 } from './migrations/007-edge-from-link';
import { migration008 } from './migrations/008-link-suggestion-ignored';
import { migration009 } from './migrations/009-search-gaps';
import { migration010 } from './migrations/010-code-anchors';
import { migration011 } from './migrations/011-more-types';
import { migration012 } from './migrations/012-code-state';
import { migration013 } from './migrations/013-lessons';
import { migration014 } from './migrations/014-quality';
import { migration015 } from './migrations/015-assistant-views';
import { inTransaction } from './transaction';

export interface Migration {
  /** Valeur de PRAGMA user_version une fois la migration appliquée. */
  version: number;
  name: string;
  sql: string;
  /**
   * Clés étrangères désactivées pendant la migration (reconstruction d'une
   * table référencée) : PRAGMA foreign_keys est sans effet dans une
   * transaction. Elles sont vérifiées avant le COMMIT.
   */
  disableForeignKeys?: boolean;
}

/** Liste ordonnée, versions contiguës à partir de 1. */
export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
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

function foreignKeysEnabled(db: DatabaseSync): boolean {
  const row = db.prepare('PRAGMA foreign_keys').get() as
    | { foreign_keys: number }
    | undefined;
  return row?.foreign_keys === 1;
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
    const foreignKeys = migration.disableForeignKeys
      ? foreignKeysEnabled(db)
      : false;
    if (foreignKeys) db.exec('PRAGMA foreign_keys = OFF');
    try {
      inTransaction(db, () => {
        // Un autre processus (application, serveur MCP) a pu appliquer la
        // migration entre-temps : la version est relue sous verrou.
        if (getSchemaVersion(db) >= migration.version) return;
        db.exec(migration.sql);
        if (migration.disableForeignKeys) {
          const violations = db.prepare('PRAGMA foreign_key_check').all();
          if (violations.length > 0) {
            throw new Error(
              `${violations.length} référence(s) invalide(s) après la migration.`,
            );
          }
        }
        // user_version fait partie de l'en-tête : il est annulé avec la transaction.
        db.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
      });
    } catch (cause) {
      throw new NodalError(
        'MIGRATION_FAILED',
        `La mise à jour du fichier vers le schéma ${migration.version} (${migration.name}) a échoué.`,
        { cause },
      );
    } finally {
      if (foreignKeys) db.exec('PRAGMA foreign_keys = ON');
    }
  }
  return getSchemaVersion(db);
}
