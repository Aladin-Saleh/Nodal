/**
 * Contexte automatique (hook d'assistant) : avant chaque demande, l'assistant
 * lance le serveur de Nodal en mode `--context`, qui ajoute au contexte les
 * nœuds et documents pertinents (voir src/mcp/context-hook.ts). Ce module
 * décrit le hook et l'ajoute aux réglages d'un projet. Logique pure.
 */

/** Assistants dont les hooks peuvent ajouter du contexte à une demande. */
export const CONTEXT_HOOK_CLIENTS = ['claude-code', 'gemini-cli'] as const;
export type ContextHookClient = (typeof CONTEXT_HOOK_CLIENTS)[number];

export const isContextHookClient = (
  client: string,
): client is ContextHookClient =>
  (CONTEXT_HOOK_CLIENTS as readonly string[]).includes(client);

/** Événement déclenché à chaque demande, avant que l'assistant ne réponde. */
export const CONTEXT_HOOK_EVENT: Record<ContextHookClient, string> = {
  'claude-code': 'UserPromptSubmit',
  'gemini-cli': 'BeforeAgent',
};

/** Fichier de réglages du projet où le hook est ajouté (relatif au dossier). */
export const CONTEXT_HOOK_SETTINGS_FILE: Record<ContextHookClient, string> = {
  // Réglages locaux, non versionnés : le chemin de l'espace est personnel.
  'claude-code': '.claude/settings.local.json',
  'gemini-cli': '.gemini/settings.json',
};

/** Nom du hook dans les réglages de Gemini CLI. */
const HOOK_NAME = 'nodal-context';

/** Argument entre guillemets doubles (PowerShell, cmd et shells POSIX). */
const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;

/** Commande du hook : le serveur de Nodal en mode contexte. */
export function contextHookCommand(
  serverPath: string,
  workspaceFile: string,
): string {
  return `node ${quote(serverPath)} ${quote(workspaceFile)} --context`;
}

/** Commande installée par Nodal (à remplacer plutôt qu'à dupliquer). */
export const isNodalContextCommand = (command: unknown): boolean =>
  typeof command === 'string' &&
  command.includes('nodal-mcp') &&
  command.includes('--context');

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Entrée de hook à ajouter sous `hooks[événement]`. */
export function contextHookEntry(
  client: ContextHookClient,
  command: string,
): Json {
  return client === 'claude-code'
    ? // Délai en secondes : la recherche prend quelques dizaines de ms.
      { hooks: [{ type: 'command', command, timeout: 10 }] }
    : { matcher: '*', hooks: [{ name: HOOK_NAME, type: 'command', command }] };
}

/**
 * Réglages avec le hook de Nodal : les autres réglages et hooks sont gardés,
 * un ancien hook de Nodal (autre espace, autre chemin) est remplacé.
 */
export function withContextHook(
  settings: unknown,
  client: ContextHookClient,
  command: string,
): Json {
  const base = isObject(settings) ? settings : {};
  const hooks = isObject(base.hooks) ? base.hooks : {};
  const event = CONTEXT_HOOK_EVENT[client];
  const entries = Array.isArray(hooks[event])
    ? (hooks[event] as unknown[])
    : [];
  const others = entries.flatMap((entry) => {
    if (!isObject(entry) || !Array.isArray(entry.hooks)) return [entry];
    const kept = entry.hooks.filter(
      (hook) => !(isObject(hook) && isNodalContextCommand(hook.command)),
    );
    if (kept.length === entry.hooks.length) return [entry];
    return kept.length > 0 ? [{ ...entry, hooks: kept }] : [];
  });
  return {
    ...base,
    hooks: {
      ...hooks,
      [event]: [...others, contextHookEntry(client, command)],
    },
  };
}

/** Bloc de réglages à copier (sans fusion), pour une installation manuelle. */
export function contextHookSnippet(
  client: ContextHookClient,
  command: string,
): string {
  return JSON.stringify(withContextHook({}, client, command), null, 2);
}
