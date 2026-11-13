/**
 * Installation du contexte automatique dans un dossier de projet : le hook
 * est ajouté au fichier de réglages de l'assistant (créé au besoin), sans
 * toucher au reste. Un fichier illisible n'est jamais réécrit.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTEXT_HOOK_SETTINGS_FILE,
  withContextHook,
  type ContextHookClient,
} from '../shared/context-hook';
import { NodalError } from '../shared/errors';

/** Ajoute le hook ; renvoie le chemin du fichier de réglages écrit. */
export function installContextHook(
  projectDir: string,
  client: ContextHookClient,
  command: string,
): string {
  const file = path.join(projectDir, CONTEXT_HOOK_SETTINGS_FILE[client]);
  let settings: unknown = {};
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    try {
      settings = text.trim() === '' ? {} : JSON.parse(text);
    } catch {
      throw new NodalError(
        'VALIDATION_ERROR',
        `${file} n’est pas un JSON valide : corrigez-le, ou ajoutez le hook à la main.`,
      );
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify(withContextHook(settings, client, command), null, 2)}\n`,
  );
  return file;
}
