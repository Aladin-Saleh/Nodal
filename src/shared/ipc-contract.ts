/**
 * Contrat IPC typé, partagé par main, preload et renderer.
 *
 * Ce module ne doit contenir aucune dépendance d'exécution (pas de zod) pour
 * rester léger dans le bundle preload. Les schémas de validation sont dans
 * `ipc-schemas.ts`, utilisés uniquement côté main.
 */
import type { SerializedError } from './errors';

export const IPC_CHANNELS = {
  appGetInfo: 'app:getInfo',
  workspaceCreate: 'workspace:create',
  workspaceOpen: 'workspace:open',
  workspaceClose: 'workspace:close',
  workspaceGetCurrent: 'workspace:getCurrent',
} as const;
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface AppInfo {
  appName: string;
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  sqliteVersion: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  description: string | null;
  filePath: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkspaceInput {
  name: string;
}

/** Arguments et résultat de chaque canal. */
export interface IpcContract {
  'app:getInfo': { args: []; result: AppInfo };
  /** `null` si l'utilisateur annule la boîte de dialogue. */
  'workspace:create': {
    args: [CreateWorkspaceInput];
    result: WorkspaceInfo | null;
  };
  /** `null` si l'utilisateur annule la boîte de dialogue. */
  'workspace:open': { args: []; result: WorkspaceInfo | null };
  'workspace:close': { args: []; result: null };
  'workspace:getCurrent': { args: []; result: WorkspaceInfo | null };
}

export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args'];
export type IpcResultData<C extends IpcChannel> = IpcContract[C]['result'];

/** Enveloppe de réponse : le main ne laisse jamais remonter d'exception brute. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SerializedError };

/** API exposée par le preload sur `window.nodal`. */
export interface NodalApi {
  app: {
    getInfo(): Promise<IpcResult<AppInfo>>;
  };
  workspace: {
    create(
      input: CreateWorkspaceInput,
    ): Promise<IpcResult<WorkspaceInfo | null>>;
    open(): Promise<IpcResult<WorkspaceInfo | null>>;
    close(): Promise<IpcResult<null>>;
    getCurrent(): Promise<IpcResult<WorkspaceInfo | null>>;
  };
}
