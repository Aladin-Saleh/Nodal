import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
  createIpcHandler,
  routeSenderByChannel,
} from '../../../src/main/ipc/handler';
import { createImplementations } from '../../../src/main/ipc/register';
import type { FileDialogs } from '../../../src/main/file-dialogs';
import type { RecentWorkspacesStore } from '../../../src/main/workspace/recent-workspaces';
import type { WorkspaceService } from '../../../src/main/workspace/workspace-service';
import { NodalError } from '../../../src/shared/errors';
import type { WorkspaceInfo } from '../../../src/shared/ipc-contract';
import { DEFAULT_PREFERENCES } from '../../../src/shared/preferences';

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

describe('routeSenderByChannel', () => {
  const main = vi.fn((e: IpcMainInvokeEvent) => e === mainEvent);
  const capture = vi.fn((e: IpcMainInvokeEvent) => e === captureEvent);
  const mainEvent = { id: 'main' } as unknown as IpcMainInvokeEvent;
  const captureEvent = { id: 'capture' } as unknown as IpcMainInvokeEvent;
  const route = routeSenderByChannel(main, capture);

  it('réserve les canaux de capture à la fenêtre de capture', () => {
    expect(route(captureEvent, 'capture:submit')).toBe(true);
    expect(route(captureEvent, 'capture:getTarget')).toBe(true);
    expect(route(mainEvent, 'capture:submit')).toBe(false);
  });

  it('ne donne à la fenêtre de capture que la lecture des préférences', () => {
    expect(route(captureEvent, 'preferences:get')).toBe(true);
    expect(route(captureEvent, 'preferences:update')).toBe(false);
    expect(route(captureEvent, 'node:list')).toBe(false);
    expect(route(captureEvent, 'workspace:delete')).toBe(false);
  });

  it('laisse à la fenêtre principale tous les autres canaux', () => {
    expect(route(mainEvent, 'node:list')).toBe(true);
    expect(route(mainEvent, 'capture:open')).toBe(true);
    expect(route(mainEvent, 'preferences:get')).toBe(true);
  });
});

function setup(pickedPath: string | null, confirmed = true) {
  const workspaces = {
    create: vi.fn(() => workspace),
    open: vi.fn(() => workspace),
    close: vi.fn(),
    getCurrent: vi.fn(() => workspace),
  } as unknown as WorkspaceService;
  const dialogs: FileDialogs = {
    pickNewWorkspacePath: vi.fn(async () => pickedPath),
    pickExistingWorkspacePath: vi.fn(async () => pickedPath),
    pickAttachmentPaths: vi.fn(async () => []),
    pickAttachmentSavePath: vi.fn(async () => null),
    pickExportParentDirectory: vi.fn(async () => null),
    pickImportFolder: vi.fn(async () => null),
    pickMarkdownFolder: vi.fn(async () => null),
    pickComparisonFile: vi.fn(async () => null),
    pickCodeRoot: vi.fn(async () => null),
    pickProjectFolder: vi.fn(async () => null),
    pickAnchorFiles: vi.fn(async () => []),
    pickNodalSavePath: vi.fn(async () => null),
    confirm: vi.fn(async () => confirmed),
  };
  const recent = {
    touch: vi.fn(),
    remove: vi.fn(),
    resolve: vi.fn(() => null),
    list: vi.fn(() => []),
  } as unknown as RecentWorkspacesStore;
  const trash = vi.fn(async () => undefined);
  const impl = createImplementations({
    workspaces,
    recent,
    dialogs,
    trash,
    getAppInfo: () => {
      throw new Error('non utilisé');
    },
    setUnsavedChanges: vi.fn(),
    getPreferences: () => DEFAULT_PREFERENCES,
    updatePreferences: vi.fn(),
    isTrustedSender: trusted,
    quickCapture: {
      target: vi.fn(() => null),
      submit: vi.fn(() => ({ workspaceName: 'KB', nodeId: 'n1' })),
      open: vi.fn(),
      shortcutRegistered: vi.fn(() => true),
    },
    terminals: {
      listShells: vi.fn(async () => [{ id: 'pwsh', name: 'PowerShell 7' }]),
      create: vi.fn(async () => ({
        id: '1',
        shell: 'PowerShell 7',
        shellId: 'pwsh',
        cwd: 'C:/',
      })),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    },
  });
  return { impl, workspaces, dialogs, recent, trash };
}

describe('createImplementations', () => {
  it('crée l’espace au chemin choisi et le mémorise dans les récents', async () => {
    const { impl, workspaces, dialogs, recent } = setup('C:/kb.nodal');
    await expect(impl['workspace:create']({ name: 'KB' })).resolves.toBe(
      workspace,
    );
    expect(dialogs.pickNewWorkspacePath).toHaveBeenCalledWith('KB');
    expect(workspaces.create).toHaveBeenCalledWith('C:/kb.nodal', 'KB');
    expect(recent.touch).toHaveBeenCalledWith('C:/kb.nodal', 'KB');
  });

  it('renvoie null si la boîte de dialogue est annulée', async () => {
    const { impl, workspaces } = setup(null);
    await expect(impl['workspace:create']({ name: 'KB' })).resolves.toBeNull();
    await expect(impl['workspace:open']()).resolves.toBeNull();
    expect(workspaces.create).not.toHaveBeenCalled();
    expect(workspaces.open).not.toHaveBeenCalled();
  });

  it('refuse un espace récent inconnu', async () => {
    const { impl } = setup(null);
    expect(() => impl['workspace:openRecent']({ id: 'inconnu' })).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('ne supprime rien si la suppression de l’espace n’est pas confirmée', async () => {
    const { impl, workspaces, trash } = setup(null, false);
    await expect(impl['workspace:delete']()).resolves.toBe(false);
    expect(workspaces.close).not.toHaveBeenCalled();
    expect(trash).not.toHaveBeenCalled();
  });

  it('ferme l’espace puis place son fichier dans la corbeille', async () => {
    const { impl, workspaces, trash, recent } = setup(null, true);
    await expect(impl['workspace:delete']()).resolves.toBe(true);
    expect(workspaces.close).toHaveBeenCalled();
    expect(trash).toHaveBeenCalledWith('C:/kb.nodal');
    expect(recent.remove).toHaveBeenCalled();
  });
});
