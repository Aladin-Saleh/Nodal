/**
 * Connexion d'un assistant IA en une fois : serveur MCP ajouté à sa
 * configuration, skills et contexte automatique dans le projet. Le reste des
 * fichiers est conservé ; un fichier illisible n'est jamais réécrit.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTEXT_HOOK_SETTINGS_FILE,
  contextHookCommand,
  isContextHookClient,
} from '../shared/context-hook';
import { NodalError } from '../shared/errors';
import {
  assistantInstructions,
  INSTRUCTIONS_FILE,
  isProjectClient,
  mcpServerEntry,
  SERVER_NAME,
  type McpClient,
} from '../shared/mcp-clients';
import { installContextHook } from './context-hook-install';
import { installInstructions } from './instructions-file';
import { installSkills, skillsDirectory } from './skill-install';

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (file: string) =>
  new NodalError(
    'VALIDATION_ERROR',
    `${file} n’a pas pu être lu (format inattendu) : corrigez-le, ou utilisez la configuration manuelle.`,
  );

/** Fichier temporaire puis renommage : une coupure ne tronque pas les réglages. */
function writeFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.nodal.tmp`;
  try {
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

const readText = (file: string): string =>
  fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    : '';

function readJson(file: string): Json {
  const text = readText(file);
  if (text.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalid(file);
  }
  if (!isObject(parsed)) throw invalid(file);
  return parsed;
}

const writeJson = (file: string, value: Json) =>
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

/** Ajoute (ou remplace) le serveur sous `key`. */
function addJsonServer(file: string, key: string, entry: Json): void {
  const config = readJson(file);
  const servers = config[key] ?? {};
  if (!isObject(servers)) throw invalid(file);
  writeJson(file, { ...config, [key]: { ...servers, [SERVER_NAME]: entry } });
}

/** Serveur `nodal` de Codex écrit autrement que par sa table. */
const OTHER_CODEX_FORM =
  /^\s*(?:\[?\s*mcp_servers\s*\.\s*)?["']?nodal["']?\s*[.=\]]/m;

/** Table `[mcp_servers.nodal]` de Codex, remplacée si elle existe. */
export function withCodexServer(
  text: string,
  entry: { command: string; args: string[] },
): string | null {
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const table = [
    header,
    `command = ${JSON.stringify(entry.command)}`,
    `args = [${entry.args.map((arg) => JSON.stringify(arg)).join(', ')}]`,
  ];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) {
    // Même serveur écrit autrement : une seconde définition serait une erreur.
    if (OTHER_CODEX_FORM.test(text)) return null;
    const before = text.trimEnd();
    return `${before}${before ? '\n\n' : ''}${table.join('\n')}\n`;
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
  const rest = lines.slice(end);
  return [
    ...lines.slice(0, start),
    ...table,
    ...(rest.length ? ['', ...rest] : ['']),
  ].join('\n');
}

/** Claude Code : serveur du projet accepté d'avance (l'utilisateur l'a demandé). */
function approveProjectServer(file: string): void {
  const settings = readJson(file);
  const names = (value: unknown) =>
    Array.isArray(value) ? (value as unknown[]) : [];
  const disabled = names(settings.disabledMcpjsonServers);
  writeJson(file, {
    ...settings,
    enabledMcpjsonServers: [
      ...new Set([...names(settings.enabledMcpjsonServers), SERVER_NAME]),
    ],
    ...(disabled.includes(SERVER_NAME) && {
      disabledMcpjsonServers: disabled.filter((name) => name !== SERVER_NAME),
    }),
  });
}

/**
 * Fichiers que Nodal vient de créer, avec des chemins propres à ce poste :
 * hors de git par `.git/info/exclude` (local, jamais partagé).
 */
function excludeFromGit(projectDir: string, files: readonly string[]): void {
  const git = path.join(projectDir, '.git');
  if (files.length === 0 || !fs.existsSync(git)) return;
  // Copie de travail liée (.git est un fichier) : rien à faire ici.
  if (!fs.statSync(git).isDirectory()) return;
  const exclude = path.join(git, 'info', 'exclude');
  const text = readText(exclude);
  const known = new Set(text.split(/\r?\n/));
  const added = files
    .map(
      (file) => `/${path.relative(projectDir, file).split(path.sep).join('/')}`,
    )
    .filter((line) => !known.has(line));
  if (added.length === 0) return;
  const before = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  writeFile(exclude, `${before}${added.join('\n')}\n`);
}

export interface ConnectOptions {
  client: McpClient;
  /** Dossier du projet ; sans objet pour un assistant configuré globalement. */
  projectDir: string | null;
  home: string;
  appData: string;
  nodePath: string;
  serverPath: string;
  workspaceFile: string;
  workspaceName: string;
  allowWrites: boolean;
}

function configFile({ client, projectDir, home, appData }: ConnectOptions) {
  const inProject = (...parts: string[]) => path.join(projectDir!, ...parts);
  switch (client) {
    case 'claude-code':
      return inProject('.mcp.json');
    case 'gemini-cli':
      return inProject('.gemini', 'settings.json');
    case 'cursor':
      return inProject('.cursor', 'mcp.json');
    case 'vscode':
      return inProject('.vscode', 'mcp.json');
    case 'codex':
      return path.join(home, '.codex', 'config.toml');
    case 'claude-desktop':
      return path.join(appData, 'Claude', 'claude_desktop_config.json');
  }
}

/** Claude Code : même serveur déjà ajouté par `claude mcp add`, qui prime. */
function hasLocalClaudeServer(home: string, projectDir: string): boolean {
  try {
    const { projects } = readJson(path.join(home, '.claude.json'));
    if (!isObject(projects)) return false;
    const key = (dir: string) => path.resolve(dir).toLowerCase();
    return Object.entries(projects).some(
      ([dir, project]) =>
        key(dir) === key(projectDir) &&
        isObject(project) &&
        isObject(project.mcpServers) &&
        SERVER_NAME in project.mcpServers,
    );
  } catch {
    return false;
  }
}

/** Connecte l'assistant ; renvoie les fichiers et dossiers écrits. */
export function connectAssistant(options: ConnectOptions): {
  files: string[];
  note: string | null;
} {
  const { client, projectDir, home, nodePath, serverPath, workspaceFile } =
    options;
  if (isProjectClient(client) && !projectDir)
    throw new NodalError('VALIDATION_ERROR', 'Aucun dossier de projet choisi.');
  const entry = mcpServerEntry(
    nodePath,
    [serverPath, workspaceFile],
    !options.allowWrites,
  );
  const config = configFile(options);
  const settings =
    projectDir && isContextHookClient(client)
      ? path.join(projectDir, CONTEXT_HOOK_SETTINGS_FILE[client])
      : null;
  const personal = [...new Set([config, ...(settings ? [settings] : [])])];
  const created = personal.filter((file) => !fs.existsSync(file));

  // Tout est lu avant la première écriture : un fichier illisible arrête ici.
  for (const file of personal) if (!file.endsWith('.toml')) readJson(file);
  const codex =
    client === 'codex' ? withCodexServer(readText(config), entry) : null;
  if (client === 'codex' && codex === null) throw invalid(config);

  const files = projectDir
    ? [installSkills(skillsDirectory(projectDir, client))]
    : [];
  if (codex !== null) writeFile(config, codex);
  else if (client === 'vscode')
    addJsonServer(config, 'servers', { type: 'stdio', ...entry });
  else addJsonServer(config, 'mcpServers', entry);
  if (projectDir && isContextHookClient(client)) {
    installContextHook(
      projectDir,
      client,
      contextHookCommand(serverPath, workspaceFile, nodePath, client),
    );
    if (client === 'claude-code') approveProjectServer(settings!);
  }
  if (projectDir && isProjectClient(client))
    excludeFromGit(projectDir, created);
  const notes: string[] = [];
  const instructionsFile = INSTRUCTIONS_FILE[client];
  if (projectDir && instructionsFile) {
    const file = path.join(projectDir, instructionsFile);
    const text = assistantInstructions(
      options.workspaceName,
      options.allowWrites,
    );
    if (installInstructions(file, text)) files.push(file);
    else
      notes.push(
        `${instructionsFile} contient déjà des consignes Nodal : il n’a pas été modifié.`,
      );
  }
  if (client === 'claude-code' && hasLocalClaudeServer(home, projectDir!))
    notes.push(
      `Un serveur « ${SERVER_NAME} » ajouté à la main prime sur celui-ci : retirez-le avec « claude mcp remove ${SERVER_NAME} -s local ».`,
    );
  return {
    files: [...personal, ...files],
    note: notes.join(' ') || null,
  };
}
