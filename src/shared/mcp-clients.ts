/**
 * Configuration du serveur MCP de Nodal pour chaque assistant IA : commande
 * à lancer ou fichier de configuration, et fichier d'instructions du projet.
 * Logique pure, testée sans React.
 */

/** Nom du serveur dans la configuration de l'assistant. */
export const SERVER_NAME = 'nodal';

export const MCP_CLIENTS = [
  'claude-code',
  'gemini-cli',
  'codex',
  'claude-desktop',
  'cursor',
  'vscode',
] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

export const MCP_CLIENT_LABELS: Record<McpClient, string> = {
  'claude-code': 'Claude Code',
  'gemini-cli': 'Gemini CLI',
  codex: 'Codex CLI',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  vscode: 'VS Code (GitHub Copilot)',
};

/** Configurés dans le dossier d'un projet (les autres : pour tout le poste). */
export const isProjectClient = (client: McpClient): boolean =>
  client !== 'codex' && client !== 'claude-desktop';

/** Fichier d'instructions du projet, ou `null` si l'assistant n'en lit pas. */
export const INSTRUCTIONS_FILE: Record<McpClient, string | null> = {
  'claude-code': 'CLAUDE.md',
  'gemini-cli': 'GEMINI.md',
  codex: 'AGENTS.md',
  'claude-desktop': null,
  cursor: 'AGENTS.md',
  vscode: '.github/copilot-instructions.md',
};

/**
 * Consignes à placer dans CLAUDE.md / AGENTS.md pour que l'assistant consulte
 * Nodal avant de lire des fichiers ou de répondre de mémoire (et, si
 * l'écriture est autorisée, y consigne ce qu'il apprend).
 */
export function assistantInstructions(
  workspaceName: string,
  allowWrites: boolean,
): string {
  // Déclencheur seulement : le mode d'emploi des outils est dans les
  // consignes du serveur MCP, envoyées à chaque tour (pas de doublon).
  const lines = [
    `## Base de connaissances Nodal « ${workspaceName} »`,
    '',
    `Avant de répondre sur ce sujet, de parcourir des fichiers ou de répondre de mémoire, consultez Nodal (serveur MCP \`${SERVER_NAME}\`, en commençant par \`nodal_search\`). Ne lisez les fichiers sources que si Nodal ne suffit pas, et dites-le.`,
    '',
    'Exception : la question porte seulement sur ce que fait un fichier précis. Lisez-le directement ; les nœuds qui lui sont liés arrivent d’eux-mêmes avec le contexte automatique, ou par `nodal_for_files` s’il faut le pourquoi.',
    '',
    'Avant de modifier des fichiers du code, appelez `nodal_for_files` avec leurs chemins : il donne les nœuds qui les documentent.',
  ];
  if (allowWrites) {
    lines.push(
      '',
      'Enregistrez-y ce que vous apprenez de durable (décision, explication, procédure, lien entre notions), en complétant les nœuds existants ; plusieurs écritures : `nodal_apply`.',
      '',
      'Après avoir modifié des fichiers, mettez à jour les nœuds concernés et ancrez-y les nouveaux fichiers (`nodal_apply`, opération `anchor`).',
    );
  }
  return lines.join('\n');
}

/** Ce qu'il reste à faire après la connexion automatique. */
export const AFTER_CONNECT: Record<McpClient, string> = {
  'claude-code':
    'Relancez Claude Code dans ce dossier, puis tapez /nodal-scan (ou /nodal:scan) : il documente le repo ici et le relie à ce qui y est déjà.',
  'gemini-cli': 'Relancez Gemini CLI dans ce dossier.',
  codex: 'Relancez Codex. Le serveur vaut pour tous vos projets.',
  'claude-desktop': 'Quittez puis relancez Claude Desktop.',
  cursor: 'Rouvrez le projet dans Cursor et activez « nodal » s’il le demande.',
  vscode: 'Rouvrez le projet dans VS Code et acceptez le serveur « nodal ».',
};

/** Commande du serveur, telle que la lisent les assistants. */
export function mcpServerEntry(
  nodePath: string,
  files: readonly string[],
  readOnly: boolean,
): { command: string; args: string[] } {
  return {
    command: nodePath,
    args: [...files, ...(readOnly ? ['--read-only'] : [])],
  };
}

export interface McpSetup {
  /** `command` : à lancer dans un terminal ; `file` : à coller dans un fichier. */
  kind: 'command' | 'file';
  label: string;
  text: string;
  /** Où et comment l'utiliser. */
  hint: string;
  /** Fichier d'instructions du projet, ou `null` si l'assistant n'en lit pas. */
  instructionsFile: string | null;
}

/** Argument entre guillemets doubles (PowerShell, cmd et shells POSIX). */
const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;

const json = (config: unknown) => JSON.stringify(config, null, 2);

/**
 * Configuration pour un assistant. `files` : script du serveur puis fichier de
 * l'espace ; `readOnly` ajoute `--read-only` ; `nodePath` : Node à lancer.
 */
export function mcpSetup(
  client: McpClient,
  files: readonly [serverPath: string, workspaceFile: string],
  readOnly: boolean,
  nodePath = 'node',
): McpSetup {
  const paths = files.map(quote).join(' ');
  const node = nodePath === 'node' ? nodePath : quote(nodePath);
  const entry = mcpServerEntry(nodePath, files, readOnly);
  const mcpServers = json({
    mcpServers: { [SERVER_NAME]: entry },
  });
  const instructionsFile = INSTRUCTIONS_FILE[client];
  switch (client) {
    case 'claude-code':
      return {
        kind: 'command',
        label: 'Commande (terminal, dans le dossier du projet)',
        text: `claude mcp add ${SERVER_NAME} -- ${node} ${paths}${readOnly ? ' --read-only' : ''}`,
        hint: 'Le serveur est ajouté pour ce projet ; ajoutez « -s user » après « add » pour tous vos projets. Puis /mcp pour vérifier la connexion.',
        instructionsFile,
      };
    case 'gemini-cli':
      return {
        kind: 'command',
        label: 'Commande (terminal, dans le dossier du projet)',
        // Les options destinées au serveur passent après « -- ».
        text: `gemini mcp add ${SERVER_NAME} ${node} ${paths}${readOnly ? ' -- --read-only' : ''}`,
        hint: 'Le serveur est ajouté au projet (.gemini/settings.json) ; ajoutez « -s user » après « add » pour tous vos projets. Puis /mcp dans Gemini CLI pour vérifier.',
        instructionsFile,
      };
    case 'codex':
      return {
        kind: 'command',
        label: 'Commande (terminal)',
        text: `codex mcp add ${SERVER_NAME} -- ${node} ${paths}${readOnly ? ' --read-only' : ''}`,
        hint: 'Le serveur est ajouté à ~/.codex/config.toml, pour tous vos projets.',
        instructionsFile,
      };
    case 'claude-desktop':
      return {
        kind: 'file',
        label: 'claude_desktop_config.json',
        text: mcpServers,
        hint: 'Claude Desktop → Paramètres → Développeur → Modifier la configuration. Fusionnez avec les serveurs déjà présents, puis redémarrez Claude Desktop.',
        instructionsFile,
      };
    case 'cursor':
      return {
        kind: 'file',
        label: '.cursor/mcp.json',
        text: mcpServers,
        hint: 'Dans le dossier du projet (ou ~/.cursor/mcp.json pour tous les projets). Fusionnez avec les serveurs déjà présents.',
        instructionsFile,
      };
    case 'vscode':
      return {
        kind: 'file',
        label: '.vscode/mcp.json',
        text: json({
          servers: { [SERVER_NAME]: { type: 'stdio', ...entry } },
        }),
        hint: 'Dans le dossier du projet, puis « Start » au-dessus du serveur dans ce fichier. Le mode Agent de Copilot Chat utilise alors les outils de Nodal.',
        instructionsFile,
      };
  }
}
