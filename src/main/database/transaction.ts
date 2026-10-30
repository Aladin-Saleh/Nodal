import type { DatabaseSync } from 'node:sqlite';

/**
 * Exécute `fn` dans une transaction (BEGIN IMMEDIATE … COMMIT / ROLLBACK).
 * Appelée dans une transaction déjà ouverte, elle s'y intègre : l'appelant
 * reste maître du COMMIT (écriture et journal atomiques, par exemple).
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
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
