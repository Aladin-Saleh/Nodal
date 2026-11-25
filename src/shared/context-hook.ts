/**
 * Contexte automatique (hook d'assistant) : avant chaque demande, l'assistant
 * lance le serveur de Nodal en mode `--context`, qui ajoute au contexte les
 * nœuds et documents pertinents (voir src/mcp/context-hook.ts). Claude Code
 * lance la même commande avant de lire ou modifier un fichier, et après avoir
 * résumé son contexte. Ce module décrit les hooks et les ajoute aux réglages
 * d'un projet. Logique pure.
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

/**
 * Commande du hook : le serveur de Nodal en mode contexte. Chemin de Node en
 * barres obliques et sans guillemets quand c'est possible : PowerShell
 * prendrait un premier mot entre guillemets pour un texte (d'où `&` pour
 * Gemini CLI, qui l'utilise sous Windows) et bash, des barres inverses nues
 * pour des échappements.
 */
export function contextHookCommand(
  serverPath: string,
  workspaceFile: string,
  nodePath = 'node',
  client: ContextHookClient = 'claude-code',
): string {
  const windows = /^[a-z]:[\\/]/i.test(nodePath);
  const plain = windows ? nodePath.replaceAll('\\', '/') : nodePath;
  const node = /^[\w:/.~-]+$/.test(plain)
    ? plain
    : `${windows && client === 'gemini-cli' ? '& ' : ''}${quote(plain)}`;
  return `${node} ${quote(serverPath)} ${quote(workspaceFile)} --context`;
}

/** Commande installée par Nodal (à remplacer plutôt qu'à dupliquer). */
export const isNodalContextCommand = (command: unknown): boolean =>
  typeof command === 'string' &&
  command.includes('nodal-mcp') &&
  command.includes('--context');

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Outils de Claude Code qui lisent ou modifient des fichiers. */
const FILE_TOOLS = 'Read|Edit|MultiEdit|Write|NotebookEdit|Bash|PowerShell';

/** Entrées de hooks à ajouter, par événement. */
export function contextHookEntries(
  client: ContextHookClient,
  command: string,
): Record<string, Json> {
  if (client === 'gemini-cli') {
    return {
      [CONTEXT_HOOK_EVENT[client]]: {
        matcher: '*',
        hooks: [{ name: HOOK_NAME, type: 'command', command }],
      },
    };
  }
  // Délai en secondes : la recherche prend quelques dizaines de ms.
  const hooks = [{ type: 'command', command, timeout: 10 }];
  return {
    [CONTEXT_HOOK_EVENT[client]]: { hooks },
    PreToolUse: { matcher: FILE_TOOLS, hooks },
    SessionStart: { matcher: 'compact', hooks },
  };
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
  const next: Json = { ...hooks };
  for (const [event, added] of Object.entries(
    contextHookEntries(client, command),
  )) {
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
    next[event] = [...others, added];
  }
  return { ...base, hooks: next };
}

/** Bloc de réglages à copier (sans fusion), pour une installation manuelle. */
export function contextHookSnippet(
  client: ContextHookClient,
  command: string,
): string {
  return JSON.stringify(withContextHook({}, client, command), null, 2);
}
