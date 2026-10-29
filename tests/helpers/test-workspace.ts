import path from 'node:path';
import { afterEach } from 'vitest';
import type { ContextProvider } from '../../src/main/knowledge/context';
import { WorkspaceService } from '../../src/main/workspace/workspace-service';
import { useTempDir } from './temp-dir';

export interface TestWorkspace {
  service: WorkspaceService;
  context: ContextProvider;
  dir: string;
}

/**
 * Fournit un espace .nodal neuf par test (fichier temporaire), avec une
 * horloge qui avance d'une seconde à chaque lecture.
 */
export function testWorkspaceFixture(): () => TestWorkspace {
  const tempDir = useTempDir();
  let current: TestWorkspace | null = null;

  afterEach(() => {
    current?.service.close();
    current = null;
  });

  return () => {
    if (current) return current;
    let tick = Date.parse('2026-10-29T12:00:00.000Z');
    const service = new WorkspaceService({
      now: () => new Date((tick += 1000)),
    });
    const dir = tempDir();
    service.create(path.join(dir, 'test.nodal'), 'Espace de test');
    current = { service, context: () => service.getContext(), dir };
    return current;
  };
}
