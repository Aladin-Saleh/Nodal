/**
 * Schémas zod des arguments IPC. Chaque canal déclare le tuple exact de ses
 * arguments : tout argument manquant, en trop ou mal typé est refusé.
 */
import { z } from 'zod';
import { WORKSPACE_NAME_MAX_LENGTH } from './domain';
import type { IpcArgs, IpcChannel } from './ipc-contract';

// Caractères de contrôle C0/C1 : interdits dans un nom affiché.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "Le nom de l'espace est obligatoire.")
  .max(
    WORKSPACE_NAME_MAX_LENGTH,
    `Le nom de l'espace ne doit pas dépasser ${WORKSPACE_NAME_MAX_LENGTH} caractères.`,
  )
  .refine((name) => !CONTROL_CHARS.test(name), {
    message: "Le nom de l'espace contient des caractères non autorisés.",
  });

export const createWorkspaceInputSchema = z.strictObject({
  name: workspaceNameSchema,
});

const noArgs = z.tuple([]);

export const ipcArgsSchemas = {
  'app:getInfo': noArgs,
  'workspace:create': z.tuple([createWorkspaceInputSchema]),
  'workspace:open': noArgs,
  'workspace:close': noArgs,
  'workspace:getCurrent': noArgs,
} satisfies { [C in IpcChannel]: z.ZodType<IpcArgs<C>> };
