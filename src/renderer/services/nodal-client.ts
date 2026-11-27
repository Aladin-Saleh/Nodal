/**
 * Accès typé à l'API exposée par le preload. Déballe l'enveloppe IpcResult :
 * un échec devient une NodalError (code + message lisible).
 */
import { NodalError } from '../../shared/errors';
import type {
  IpcArgs,
  IpcChannel,
  IpcResultData,
  NodalApi,
} from '../../shared/ipc-contract';
import type { AppPreferences } from '../../shared/preferences';
import type { TerminalEvent } from '../../shared/terminal';

export interface NodalClient {
  call<C extends IpcChannel>(
    channel: C,
    ...args: IpcArgs<C>
  ): Promise<IpcResultData<C>>;
  onFlushRequest(listener: () => void): () => void;
  onExternalChange(listener: () => void): () => void;
  onNodeLink(listener: () => void): () => void;
  onPreferencesChanged(
    listener: (preferences: AppPreferences) => void,
  ): () => void;
  onTerminalEvent(listener: (event: TerminalEvent) => void): () => void;
}

export function createNodalClient(api: NodalApi): NodalClient {
  return {
    async call(channel, ...args) {
      const result = await api.invoke(channel, ...args);
      if (!result.ok) {
        throw new NodalError(result.error.code, result.error.message);
      }
      return result.data;
    },
    onFlushRequest: (listener) => api.onFlushRequest(listener),
    onExternalChange: (listener) => api.onExternalChange(listener),
    onNodeLink: (listener) => api.onNodeLink(listener),
    onPreferencesChanged: (listener) => api.onPreferencesChanged(listener),
    onTerminalEvent: (listener) => api.onTerminalEvent(listener),
  };
}

/** Message affichable pour une erreur quelconque. */
export function describeError(error: unknown): string {
  if (error instanceof NodalError) return error.message;
  return "Une erreur inattendue s'est produite.";
}
