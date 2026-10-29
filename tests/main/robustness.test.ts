import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it } from 'vitest';
import {
  closeNodalDatabase,
  createNodalDatabase,
  openNodalDatabase,
} from '../../src/main/database/connection';
import { createIpcHandler } from '../../src/main/ipc/handler';
import { fromSystemError } from '../../src/shared/errors';
import { useTempDir } from '../helpers/temp-dir';

const tempDir = useTempDir();

describe('erreurs système (§10.2)', () => {
  it('signale un fichier verrouillé par un autre programme', () => {
    const file = path.join(tempDir(), 'verrouillé.nodal');
    closeNodalDatabase(createNodalDatabase(file));
    // Un autre programme garde le fichier en accès exclusif.
    const other = new DatabaseSync(file);
    other.exec('PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;');
    try {
      expect(() => openNodalDatabase(file)).toThrowError(
        expect.objectContaining({ code: 'FILE_LOCKED' }),
      );
    } finally {
      other.exec('ROLLBACK');
      other.close();
    }
    // Une fois libéré, le fichier s'ouvre normalement.
    closeNodalDatabase(openNodalDatabase(file));
  });

  it('traduit les codes SQLite et système connus', () => {
    expect(fromSystemError({ errcode: 5 })?.code).toBe('FILE_LOCKED');
    expect(fromSystemError({ errcode: 517 })?.code).toBe('FILE_LOCKED'); // BUSY_SNAPSHOT
    expect(fromSystemError({ errcode: 6 })?.code).toBe('FILE_LOCKED');
    expect(fromSystemError({ errcode: 13 })?.code).toBe('DISK_FULL');
    expect(fromSystemError({ code: 'ENOSPC' })?.code).toBe('DISK_FULL');
    expect(fromSystemError({ errcode: 19 })).toBeNull(); // contrainte : non concernée
    expect(fromSystemError(new Error('autre'))).toBeNull();
  });

  it('renvoie un message lisible au renderer plutôt qu’une erreur interne', async () => {
    const handler = createIpcHandler(
      'workspace:getCurrent',
      () => {
        throw Object.assign(new Error('database or disk is full'), {
          errcode: 13,
        });
      },
      () => true,
    );
    const result = await handler({} as IpcMainInvokeEvent);
    expect(result).toMatchObject({ ok: false, error: { code: 'DISK_FULL' } });
  });
});

/** Fichiers TypeScript de src/, récursivement. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('le code stocké n’est jamais exécuté (§2, §10.2)', () => {
  const files = sourceFiles(path.resolve('src')).map((file) => ({
    file: path.relative(process.cwd(), file),
    text: fs.readFileSync(file, 'utf8'),
  }));

  it.each([
    ['lancement de processus', /\bchild_process\b|\bspawn\(|\bexecFile\(/],
    ['évaluation de code', /\beval\(|new Function\(/],
    ['ouverture de fichiers par le système', /shell\.openPath|shell\.openItem/],
    ['injection de script', /executeJavaScript\(/],
    ['intégration Node dans le renderer', /nodeIntegration:\s*true/],
    ['contexte non isolé', /contextIsolation:\s*false/],
  ])('aucune trace de %s dans les sources', (_label, pattern) => {
    const offenders = files
      .filter(({ text }) => pattern.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
