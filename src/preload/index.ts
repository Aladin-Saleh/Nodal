/**
 * Pont minimal entre le renderer (isolé, sandboxé) et le main process.
 * Seuls les canaux de la liste blanche du contrat IPC sont accessibles ;
 * ipcRenderer lui-même n'est jamais exposé.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type IpcChannel,
  type NodalApi,
} from '../shared/ipc-contract';

const allowedChannels: ReadonlySet<string> = new Set(IPC_CHANNELS);

const api: NodalApi = {
  invoke(channel, ...args) {
    if (!allowedChannels.has(channel)) {
      return Promise.reject(new Error(`Canal IPC non autorisé : ${channel}`));
    }
    return ipcRenderer.invoke(channel satisfies IpcChannel, ...args);
  },

  onFlushRequest(listener) {
    // L'événement Electron n'est pas transmis : il donne accès à `sender`.
    const handler = () => listener();
    ipcRenderer.on(IPC_EVENTS.flushRequest, handler);
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.flushRequest, handler);
    };
  },

  onPreferencesChanged(listener) {
    const handler = (_event: unknown, preferences: unknown) =>
      listener(preferences as Parameters<typeof listener>[0]);
    ipcRenderer.on(IPC_EVENTS.preferencesChanged, handler);
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.preferencesChanged, handler);
    };
  },

  onExternalChange(listener) {
    const handler = () => listener();
    ipcRenderer.on(IPC_EVENTS.externalChange, handler);
    return () => {
      ipcRenderer.removeListener(IPC_EVENTS.externalChange, handler);
    };
  },
};

contextBridge.exposeInMainWorld('nodal', api);
