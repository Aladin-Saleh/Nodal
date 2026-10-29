import type { IpcMain } from 'electron';
import {
  IPC_CHANNELS,
  type AppInfo,
  type IpcChannel,
} from '../../shared/ipc-contract';
import type { WorkspaceDialogs } from '../workspace/workspace-dialogs';
import type { WorkspaceService } from '../workspace/workspace-service';
import {
  createIpcHandler,
  type IpcImplementation,
  type SenderValidator,
} from './handler';

export interface IpcDependencies {
  workspaces: WorkspaceService;
  dialogs: WorkspaceDialogs;
  getAppInfo(): AppInfo;
  isTrustedSender: SenderValidator;
}

type Implementations = { [C in IpcChannel]: IpcImplementation<C> };

export function createImplementations(deps: IpcDependencies): Implementations {
  const { workspaces, dialogs } = deps;
  return {
    'app:getInfo': () => deps.getAppInfo(),

    'workspace:create': async ({ name }) => {
      const filePath = await dialogs.pickNewWorkspacePath(name);
      return filePath ? workspaces.create(filePath, name) : null;
    },

    'workspace:open': async () => {
      const filePath = await dialogs.pickExistingWorkspacePath();
      return filePath ? workspaces.open(filePath) : null;
    },

    'workspace:close': () => {
      workspaces.close();
      return null;
    },

    'workspace:getCurrent': () => workspaces.getCurrent(),
  };
}

export function registerIpcHandlers(
  ipcMain: IpcMain,
  deps: IpcDependencies,
): void {
  const implementations = createImplementations(deps);
  for (const channel of Object.values(IPC_CHANNELS)) {
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
