import type { IpcMainInvokeEvent } from 'electron';
import { NodalError } from '../../shared/errors';
import type {
  IpcArgs,
  IpcChannel,
  IpcResult,
  IpcResultData,
} from '../../shared/ipc-contract';
import { ipcArgsSchemas } from '../../shared/ipc-schemas';

export type SenderValidator = (event: IpcMainInvokeEvent) => boolean;

export type IpcImplementation<C extends IpcChannel> = (
  ...args: IpcArgs<C>
) => IpcResultData<C> | Promise<IpcResultData<C>>;

/**
 * Enveloppe une implémentation de canal :
 * 1. refuse un émetteur qui n'est pas la fenêtre de l'application ;
 * 2. valide les arguments avec le schéma zod du canal ;
 * 3. convertit toute exception en `{ ok: false, error }` sérialisable.
 */
export function createIpcHandler<C extends IpcChannel>(
  channel: C,
  implementation: IpcImplementation<C>,
  isTrustedSender: SenderValidator,
): (
  event: IpcMainInvokeEvent,
  ...rawArgs: unknown[]
) => Promise<IpcResult<IpcResultData<C>>> {
  const schema = ipcArgsSchemas[channel];

  return async (event, ...rawArgs) => {
    if (!isTrustedSender(event)) {
      console.warn(`[ipc] ${channel} : émetteur refusé`);
      return {
        ok: false,
        error: { code: 'FORBIDDEN_SENDER', message: 'Émetteur non autorisé.' },
      };
    }

    const parsed = schema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.issues[0]?.message ?? 'Paramètres invalides.',
        },
      };
    }

    try {
      const data = await implementation(...(parsed.data as IpcArgs<C>));
      return { ok: true, data };
    } catch (error) {
      if (error instanceof NodalError) {
        if (error.cause) console.warn(`[ipc] ${channel}`, error.cause);
        return { ok: false, error: error.toJSON() };
      }
      console.error(`[ipc] ${channel} : erreur inattendue`, error);
      return {
        ok: false,
        error: {
          code: 'INTERNAL',
          message: "Une erreur inattendue s'est produite.",
        },
      };
    }
  };
}
