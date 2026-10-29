/**
 * Pont minimal entre le renderer (isolé, sandboxé) et le main process.
 * Seules les opérations du contrat IPC sont exposées ; ipcRenderer lui-même
 * ne l'est jamais.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type IpcArgs,
  type IpcChannel,
  type IpcResult,
  type IpcResultData,
  type NodalApi,
} from '../shared/ipc-contract';

function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcArgs<C>
): Promise<IpcResult<IpcResultData<C>>> {
  return ipcRenderer.invoke(channel, ...args);
}

const api: NodalApi = {
  app: {
    getInfo: () => invoke(IPC_CHANNELS.appGetInfo),
  },
  workspace: {
    create: (input) => invoke(IPC_CHANNELS.workspaceCreate, input),
    open: () => invoke(IPC_CHANNELS.workspaceOpen),
    close: () => invoke(IPC_CHANNELS.workspaceClose),
    getCurrent: () => invoke(IPC_CHANNELS.workspaceGetCurrent),
  },
};

contextBridge.exposeInMainWorld('nodal', api);
