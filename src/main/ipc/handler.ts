import type { IpcMainInvokeEvent } from 'electron';
import { fromSystemError, NodalError } from '../../shared/errors';
import type {
  IpcArgs,
  IpcChannel,
  IpcResult,
  IpcResultData,
} from '../../shared/ipc-contract';
import { ipcArgsSchemas } from '../../shared/ipc-schemas';
import {
  CAPTURE_WINDOW_CHANNELS,
  CAPTURE_WINDOW_SHARED_CHANNELS,
} from '../../shared/quick-capture';

/** L'émetteur a-t-il le droit d'appeler ce canal ? */
export type SenderValidator = (
  event: IpcMainInvokeEvent,
  channel: IpcChannel,
) => boolean;

type WindowValidator = (event: IpcMainInvokeEvent) => boolean;

const captureOnly: ReadonlySet<string> = new Set(CAPTURE_WINDOW_CHANNELS);
const captureShared: ReadonlySet<string> = new Set(
  CAPTURE_WINDOW_SHARED_CHANNELS,
);

/**
 * Répartit les canaux entre les fenêtres : la fenêtre de capture n'appelle
 * que ses propres canaux (et lit les préférences), la fenêtre principale
 * tous les autres.
 */
export function routeSenderByChannel(
  fromMainWindow: WindowValidator,
  fromCaptureWindow: WindowValidator,
): SenderValidator {
  return (event, channel) => {
    if (captureOnly.has(channel)) return fromCaptureWindow(event);
    if (fromMainWindow(event)) return true;
    return captureShared.has(channel) && fromCaptureWindow(event);
  };
}

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
    if (!isTrustedSender(event, channel)) {
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
      const known =
        fromSystemError(error) ?? fromSystemError((error as Error)?.cause);
      if (known) {
        console.warn(`[ipc] ${channel}`, error);
        return { ok: false, error: known.toJSON() };
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
