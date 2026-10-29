/**
 * Accès typé à l'API exposée par le preload. Déballe l'enveloppe IpcResult :
 * un échec devient une NodalError (code + message lisible).
 */
import { NodalError } from '../../shared/errors';
import type {
  AppInfo,
  CreateWorkspaceInput,
  IpcResult,
  NodalApi,
  WorkspaceInfo,
} from '../../shared/ipc-contract';

export interface NodalClient {
  getAppInfo(): Promise<AppInfo>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceInfo | null>;
  openWorkspace(): Promise<WorkspaceInfo | null>;
  closeWorkspace(): Promise<void>;
  getCurrentWorkspace(): Promise<WorkspaceInfo | null>;
}

async function unwrap<T>(pending: Promise<IpcResult<T>>): Promise<T> {
  const result = await pending;
  if (!result.ok) {
    throw new NodalError(result.error.code, result.error.message);
  }
  return result.data;
}

export function createNodalClient(api: NodalApi): NodalClient {
  return {
    getAppInfo: () => unwrap(api.app.getInfo()),
    createWorkspace: (input) => unwrap(api.workspace.create(input)),
    openWorkspace: () => unwrap(api.workspace.open()),
    closeWorkspace: async () => {
      await unwrap(api.workspace.close());
    },
    getCurrentWorkspace: () => unwrap(api.workspace.getCurrent()),
  };
}

/** Message affichable pour une erreur quelconque. */
export function describeError(error: unknown): string {
  if (error instanceof NodalError) return error.message;
  return "Une erreur inattendue s'est produite.";
}
