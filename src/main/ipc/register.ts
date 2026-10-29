import fs from 'node:fs/promises';
import type { IpcMain } from 'electron';
import { NodalError } from '../../shared/errors';
import {
  IPC_CHANNELS,
  type AppInfo,
  type IpcChannel,
  type WorkspaceInfo,
} from '../../shared/ipc-contract';
import type { FileDialogs } from '../file-dialogs';
import { AttachmentService } from '../knowledge/attachment-service';
import type { ContextProvider } from '../knowledge/context';
import { DocumentService } from '../knowledge/document-service';
import { NodeService } from '../knowledge/node-service';
import { SettingsService } from '../knowledge/settings-service';
import { TagService } from '../knowledge/tag-service';
import {
  recentId,
  type RecentWorkspacesStore,
} from '../workspace/recent-workspaces';
import type { WorkspaceService } from '../workspace/workspace-service';
import {
  createIpcHandler,
  type IpcImplementation,
  type SenderValidator,
} from './handler';

export interface IpcDependencies {
  workspaces: WorkspaceService;
  recent: RecentWorkspacesStore;
  dialogs: FileDialogs;
  /** Place un fichier dans la corbeille du système. */
  trash(filePath: string): Promise<void>;
  getAppInfo(): AppInfo;
  setUnsavedChanges(unsaved: boolean): void;
  isTrustedSender: SenderValidator;
}

type Implementations = { [C in IpcChannel]: IpcImplementation<C> };

export function createImplementations(deps: IpcDependencies): Implementations {
  const { workspaces, recent, dialogs } = deps;
  const context: ContextProvider = () => workspaces.getContext();
  const nodes = new NodeService(context);
  const documents = new DocumentService(context);
  const tags = new TagService(context);
  const attachments = new AttachmentService(context);
  const settings = new SettingsService(context);

  const remember = (info: WorkspaceInfo) => {
    recent.touch(info.filePath, info.name);
    return info;
  };

  return {
    'app:getInfo': () => deps.getAppInfo(),
    'app:setUnsavedChanges': (unsaved) => {
      deps.setUnsavedChanges(unsaved);
      return null;
    },

    'workspace:create': async ({ name }) => {
      const filePath = await dialogs.pickNewWorkspacePath(name);
      return filePath ? remember(workspaces.create(filePath, name)) : null;
    },
    'workspace:open': async () => {
      const filePath = await dialogs.pickExistingWorkspacePath();
      return filePath ? remember(workspaces.open(filePath)) : null;
    },
    'workspace:openRecent': ({ id }) => {
      const filePath = recent.resolve(id);
      if (!filePath) {
        throw new NodalError('NOT_FOUND', 'Cet espace récent est introuvable.');
      }
      return remember(workspaces.open(filePath));
    },
    'workspace:listRecent': () => recent.list(),
    'workspace:removeRecent': ({ id }) => {
      recent.remove(id);
      return null;
    },
    'workspace:close': () => {
      workspaces.close();
      return null;
    },
    'workspace:getCurrent': () => workspaces.getCurrent(),
    'workspace:update': (input) => remember(workspaces.update(input)),
    'workspace:delete': async () => {
      const current = workspaces.getCurrent();
      if (!current) {
        throw new NodalError('NO_WORKSPACE_OPEN', "Aucun espace n'est ouvert.");
      }
      const confirmed = await dialogs.confirm({
        message: `Supprimer l’espace « ${current.name} » ?`,
        detail: `Le fichier ${current.filePath} sera placé dans la corbeille. Vous pourrez le restaurer depuis la corbeille de Windows.`,
        confirmLabel: 'Placer dans la corbeille',
      });
      if (!confirmed) return false;
      workspaces.close();
      try {
        await deps.trash(current.filePath);
      } catch (cause) {
        throw new NodalError(
          'IO_ERROR',
          'L’espace a été fermé mais son fichier n’a pas pu être placé dans la corbeille.',
          { cause },
        );
      }
      recent.remove(recentId(current.filePath));
      return true;
    },
    'workspace:getSettings': () => settings.get(),
    'workspace:updateSettings': (input) => settings.update(input),

    'node:list': () => nodes.list(),
    'node:get': ({ id }) => nodes.get(id),
    'node:create': (input) => nodes.create(input),
    'node:update': (input) => nodes.update(input),
    'node:move': (input) => {
      nodes.move(input);
      return null;
    },
    'node:duplicate': (input) => nodes.duplicate(input),
    'node:getDeletionImpact': ({ id }) => nodes.getDeletionImpact(id),
    'node:delete': (input) => {
      nodes.delete(input);
      return null;
    },
    'node:setTags': (input) => nodes.setTags(input),

    'document:get': ({ id }) => documents.get(id),
    'document:create': (input) => documents.create(input),
    'document:update': (input) => documents.update(input),
    'document:delete': ({ id }) => {
      documents.delete(id);
      return null;
    },
    'document:reorder': (input) => {
      documents.reorder(input);
      return null;
    },

    'tag:list': () => tags.list(),
    'tag:create': (input) => tags.create(input),
    'tag:update': (input) => tags.update(input),
    'tag:delete': ({ id }) => {
      tags.delete(id);
      return null;
    },

    'attachment:add': async ({ nodeId }) => {
      // Vérifier l'espace et le nœud avant d'ouvrir la boîte de dialogue.
      nodes.get(nodeId);
      const filePaths = await dialogs.pickAttachmentPaths();
      return filePaths.length > 0
        ? attachments.addFromPaths(nodeId, filePaths)
        : [];
    },
    'attachment:save': async ({ id }) => {
      const { fileName, data } = attachments.getData(id);
      const target = await dialogs.pickAttachmentSavePath(fileName);
      if (!target) return false;
      try {
        await fs.writeFile(target, data);
      } catch (cause) {
        throw new NodalError(
          'IO_ERROR',
          `Impossible d’enregistrer « ${fileName} ».`,
          { cause },
        );
      }
      return true;
    },
    'attachment:delete': ({ id }) => {
      attachments.delete(id);
      return null;
    },
  };
}

export function registerIpcHandlers(
  ipcMain: IpcMain,
  deps: IpcDependencies,
): void {
  const implementations = createImplementations(deps);
  for (const channel of IPC_CHANNELS) {
    // Le cast relie chaque canal à sa propre implémentation (type corrélé).
    const implementation = implementations[channel] as IpcImplementation<
      typeof channel
    >;
    ipcMain.handle(
      channel,
      createIpcHandler(channel, implementation, deps.isTrustedSender),
    );
  }
}
