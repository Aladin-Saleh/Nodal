import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';

/**
 * Crée un dossier temporaire supprimé après chaque test.
 * À appeler au niveau du module de test.
 */
export function useTempDir(): () => string {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  return () => {
    dir ??= fs.mkdtempSync(path.join(os.tmpdir(), 'nodal-test-'));
    return dir;
  };
}

export function listFiles(dir: string): string[] {
  return fs.readdirSync(dir).toSorted();
}
