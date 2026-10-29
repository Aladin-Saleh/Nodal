import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createIpcHandler } from '../../../src/main/ipc/handler';
import { createImplementations } from '../../../src/main/ipc/register';
import type { WorkspaceDialogs } from '../../../src/main/workspace/workspace-dialogs';
import type { WorkspaceService } from '../../../src/main/workspace/workspace-service';
import { NodalError } from '../../../src/shared/errors';
import type { WorkspaceInfo } from '../../../src/shared/ipc-contract';

const event = {} as IpcMainInvokeEvent;
const trusted = () => true;

const workspace: WorkspaceInfo = {
  id: 'w1',
  name: 'KB',
  description: null,
  filePath: 'C:/kb.nodal',
  schemaVersion: 1,
  createdAt: '2026-10-29T12:00:00.000Z',
  updatedAt: '2026-10-29T12:00:00.000Z',
};

describe('createIpcHandler', () => {
  it('refuse un émetteur non autorisé sans appeler l’implémentation', async () => {
    const impl = vi.fn(() => null);
    const handler = createIpcHandler('workspace:close', impl, () => false);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(handler(event)).resolves.toEqual({
      ok: false,
      error: { code: 'FORBIDDEN_SENDER', message: 'Émetteur non autorisé.' },
    });
    expect(impl).not.toHaveBeenCalled();
  });

  it.each([
    ['sans argument', []],
    ['argument mal typé', ['KB']],
    ['propriété inconnue', [{ name: 'KB', path: 'C:/evil.nodal' }]],
    ['argument en trop', [{ name: 'KB' }, 'extra']],
    ['nom vide', [{ name: '   ' }]],
  ])('refuse des paramètres invalides : %s', async (_label, args) => {
    const impl = vi.fn(() => null);
    const handler = createIpcHandler('workspace:create', impl, trusted);

    const result = await handler(event, ...args);

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(impl).not.toHaveBeenCalled();
  });

  it('refuse des arguments sur un canal qui n’en attend pas', async () => {
    const impl = vi.fn(() => null);
    const handler = createIpcHandler('workspace:open', impl, trusted);
    await expect(handler(event, 'C:/evil.nodal')).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_ERROR' },
    });
    expect(impl).not.toHaveBeenCalled();
  });

  it('transmet les arguments validés (nom normalisé)', async () => {
    const impl = vi.fn(() => workspace);
    const handler = createIpcHandler('workspace:create', impl, trusted);

    await expect(handler(event, { name: '  KB  ' })).resolves.toEqual({
      ok: true,
      data: workspace,
    });
    expect(impl).toHaveBeenCalledWith({ name: 'KB' });
  });

  it('sérialise une NodalError', async () => {
    const handler = createIpcHandler(
      'workspace:open',
      () => {
        throw new NodalError('NOT_A_NODAL_FILE', 'Pas un fichier Nodal.');
      },
      trusted,
    );
    await expect(handler(event)).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_A_NODAL_FILE', message: 'Pas un fichier Nodal.' },
    });
  });

  it('masque le détail d’une erreur inattendue', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = createIpcHandler(
      'workspace:open',
      () => {
        throw new Error('SQLITE_IOERR C:/secret/path');
      },
      trusted,
    );
    const result = await handler(event);
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

function setup(pickedPath: string | null) {
  const workspaces = {
    create: vi.fn(() => workspace),
    open: vi.fn(() => workspace),
    close: vi.fn(),
    getCurrent: vi.fn(() => null),
  } as unknown as WorkspaceService;
  const dialogs: WorkspaceDialogs = {
    pickNewWorkspacePath: vi.fn(async () => pickedPath),
    pickExistingWorkspacePath: vi.fn(async () => pickedPath),
  };
  const impl = createImplementations({
    workspaces,
    dialogs,
    getAppInfo: () => {
      throw new Error('non utilisé');
    },
    isTrustedSender: trusted,
  });
  return { impl, workspaces, dialogs };
}

describe('createImplementations', () => {
  it('crée l’espace au chemin choisi dans la boîte de dialogue', async () => {
    const { impl, workspaces, dialogs } = setup('C:/kb.nodal');
    await expect(impl['workspace:create']({ name: 'KB' })).resolves.toBe(
      workspace,
    );
    expect(dialogs.pickNewWorkspacePath).toHaveBeenCalledWith('KB');
    expect(workspaces.create).toHaveBeenCalledWith('C:/kb.nodal', 'KB');
  });

  it('renvoie null si la boîte de dialogue est annulée', async () => {
    const { impl, workspaces } = setup(null);
    await expect(impl['workspace:create']({ name: 'KB' })).resolves.toBeNull();
    await expect(impl['workspace:open']()).resolves.toBeNull();
    expect(workspaces.create).not.toHaveBeenCalled();
    expect(workspaces.open).not.toHaveBeenCalled();
  });
});
