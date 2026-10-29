import type { DatabaseSync } from 'node:sqlite';

/** Exécute `fn` dans une transaction (BEGIN IMMEDIATE … COMMIT / ROLLBACK). */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
