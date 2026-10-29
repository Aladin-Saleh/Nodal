/**
 * Sauvegarde et vérification d'intégrité d'un espace (§6.10).
 */
import fs from 'node:fs';
import { NodalError } from '../../shared/errors';
import type { IntegrityReport } from '../../shared/model';
import type { ContextProvider, ServiceContext } from './context';
import { asRows } from './rows';

/**
 * Reconstruit l'index de recherche à partir des nœuds et documents (utile si
 * le fichier a été modifié hors de l'application).
 */
export function rebuildSearchIndex(ctx: ServiceContext): void {
  ctx.db.exec(`
    DELETE FROM search_index;
    INSERT INTO search_index (kind, item_id, node_id, title, body)
      SELECT 'node', id, id, title, COALESCE(summary, '') FROM node;
    INSERT INTO search_index (kind, item_id, node_id, title, body)
      SELECT 'document', id, node_id, title, body FROM document;
  `);
}

export class MaintenanceService {
  constructor(private readonly context: ContextProvider) {}

  /**
   * Copie cohérente de l'espace dans un nouveau fichier .nodal (VACUUM INTO),
   * sans interrompre l'édition. Le fichier cible ne doit pas exister.
   */
  backupTo(targetPath: string): void {
    if (fs.existsSync(targetPath)) {
      throw new NodalError(
        'FILE_ALREADY_EXISTS',
        `Le fichier « ${targetPath} » existe déjà. Choisissez un autre nom.`,
      );
    }
    try {
      this.context().db.prepare('VACUUM INTO ?').run(targetPath);
    } catch (cause) {
      fs.rmSync(targetPath, { force: true });
      throw new NodalError(
        'IO_ERROR',
        'La sauvegarde a échoué : vérifiez l’accès au dossier et l’espace disque.',
        { cause },
      );
    }
  }

  /**
   * Vérifie la structure SQLite, les clés étrangères et l'index de recherche.
   * Un index de recherche incohérent est reconstruit automatiquement.
   */
  checkIntegrity(): IntegrityReport {
    const ctx = this.context();
    const { db } = ctx;
    const checks: IntegrityReport['checks'] = [];

    const structure = asRows<{ integrity_check: string }>(
      db.prepare('PRAGMA integrity_check').all(),
    ).map((row) => row.integrity_check);
    checks.push({
      name: 'Structure du fichier',
      ok: structure.length === 1 && structure[0] === 'ok',
      details: structure[0] === 'ok' ? [] : structure.slice(0, 20),
    });

    const foreignKeys = asRows<{ table: string; parent: string }>(
      db.prepare('PRAGMA foreign_key_check').all(),
    );
    checks.push({
      name: 'Références entre éléments',
      ok: foreignKeys.length === 0,
      details: foreignKeys
        .slice(0, 20)
        .map((row) => `${row.table} → ${row.parent} : référence manquante`),
    });

    const expected = (
      db
        .prepare(
          'SELECT (SELECT count(*) FROM node) + (SELECT count(*) FROM document) AS n',
        )
        .get() as { n: number }
    ).n;
    const indexed = (
      db.prepare('SELECT count(*) AS n FROM search_index').get() as {
        n: number;
      }
    ).n;
    let indexOk = expected === indexed;
    try {
      db.exec(
        "INSERT INTO search_index (search_index) VALUES ('integrity-check')",
      );
    } catch {
      indexOk = false;
    }
    if (!indexOk) rebuildSearchIndex(ctx);
    checks.push({
      name: 'Index de recherche',
      ok: true,
      details: indexOk ? [] : ['Index incohérent : il a été reconstruit.'],
    });

    return { ok: checks.every((check) => check.ok), checks };
  }
}
