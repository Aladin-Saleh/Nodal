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
  switch (client) {
    case 'claude-code':
      return {
        kind: 'command',
        label: 'Commande (terminal, dans le dossier du projet)',
        text: `claude mcp add ${SERVER_NAME} -- ${node} ${paths}${readOnly ? ' --read-only' : ''}`,
        hint: 'Le serveur est ajouté pour ce projet ; ajoutez « -s user » après « add » pour tous vos projets. Puis /mcp pour vérifier la connexion.',
        instructionsFile: 'CLAUDE.md',
      };
    case 'gemini-cli':
      return {
        kind: 'command',
        label: 'Commande (terminal, dans le dossier du projet)',
        // Les options destinées au serveur passent après « -- ».
        text: `gemini mcp add ${SERVER_NAME} ${node} ${paths}${readOnly ? ' -- --read-only' : ''}`,
        hint: 'Le serveur est ajouté au projet (.gemini/settings.json) ; ajoutez « -s user » après « add » pour tous vos projets. Puis /mcp dans Gemini CLI pour vérifier.',
        instructionsFile: 'GEMINI.md',
      };
    case 'codex':
      return {
        kind: 'command',
        label: 'Commande (terminal)',
        text: `codex mcp add ${SERVER_NAME} -- ${node} ${paths}${readOnly ? ' --read-only' : ''}`,
        hint: 'Le serveur est ajouté à ~/.codex/config.toml, pour tous vos projets.',
        instructionsFile: 'AGENTS.md',
      };
    case 'claude-desktop':
      return {
        kind: 'file',
        label: 'claude_desktop_config.json',
        text: mcpServers,
        hint: 'Claude Desktop → Paramètres → Développeur → Modifier la configuration. Fusionnez avec les serveurs déjà présents, puis redémarrez Claude Desktop.',
        instructionsFile: null,
      };
    case 'cursor':
      return {
        kind: 'file',
        label: '.cursor/mcp.json',
        text: mcpServers,
        hint: 'Dans le dossier du projet (ou ~/.cursor/mcp.json pour tous les projets). Fusionnez avec les serveurs déjà présents.',
        instructionsFile: 'AGENTS.md',
      };
    case 'vscode':
      return {
        kind: 'file',
        label: '.vscode/mcp.json',
        text: json({
          servers: { [SERVER_NAME]: { type: 'stdio', ...entry } },
        }),
        hint: 'Dans le dossier du projet, puis « Start » au-dessus du serveur dans ce fichier. Le mode Agent de Copilot Chat utilise alors les outils de Nodal.',
        instructionsFile: '.github/copilot-instructions.md',
      };
  }
}
