/**
 * Point d'entrée du serveur MCP (stdio), exécuté par Node.js ≥ 22.13 :
 *
 *   node nodal-mcp.cjs "C:\chemin\vers\espace.nodal" [--read-only]
 *
 * Avec --context, il ne sert pas le protocole : il lit une demande (hook
 * d'assistant, JSON sur stdin) et écrit le contexte à y ajouter
 * (context-hook.ts).
 *
 * Suivi d'une commande (search, files…), il l'exécute et s'arrête (cli.ts).
 *
 * Il n'est pas lancé par l'exécutable Electron : sous Windows, le processus
 * principal d'Electron écrit une ligne vide sur stdout au démarrage, ce qui
 * corromprait le flux JSON-RPC.
 */
import fs from 'node:fs';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { contextHookOutput } from './context-hook';
import { CLI_USAGE, parseCommand, runCalls, splitCommands } from './cli';
import { createNodalMcpServer } from './server';

declare const NODAL_VERSION: string;

const USAGE = `Usage : node nodal-mcp.cjs <fichier.nodal> [--read-only | --all-tools | --context] [commande…]\n\n${CLI_USAGE}`;

const OPTIONS = new Set(['--read-only', '--all-tools', '--context']);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.error(USAGE);
    return;
  }
  const readOnly = args.includes('--read-only');
  const file =
    args.find((arg) => !arg.startsWith('--')) ?? process.env.NODAL_WORKSPACE;
  if (!file) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (args.includes('--context')) {
    const output = contextHookOutput(
      path.resolve(file),
      fs.readFileSync(0, 'utf8'),
    );
    if (output) process.stdout.write(output);
    return;
  }
  // stdout est réservé au protocole : tout diagnostic part sur stderr.
  console.log = console.error;
  // Lancé par un client MCP depuis un dépôt git (Claude Code : dossier du
  // projet) : dossier de code par défaut si l'espace n'en déclare aucun.
  const cwd = process.cwd();
  const projectRoot = fs.existsSync(path.join(cwd, '.git')) ? cwd : null;
  // Commande après le fichier : exécutée, sans servir le protocole.
  const commands = splitCommands(
    args.slice(args.indexOf(file) + 1).filter((arg) => !OPTIONS.has(arg)),
  );
  const server = createNodalMcpServer({
    workspaceFile: path.resolve(file),
    version: NODAL_VERSION,
    readOnly,
    allTools: args.includes('--all-tools'),
    projectRoot,
  });
  if (commands.length > 0) {
    const calls = commands.map((words) =>
      parseCommand(words, () => fs.readFileSync(0, 'utf8')),
    );
    const { text, failed } = await runCalls(server, calls, NODAL_VERSION);
    process.stdout.write(`${text}\n`);
    if (failed) process.exitCode = 1;
    return;
  }
  await server.connect(new StdioServerTransport());
  console.error(
    `[nodal-mcp] prêt (${readOnly ? 'lecture seule' : 'lecture et écriture'}) : ${path.resolve(file)}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? `[nodal-mcp] ${error.message}` : error,
  );
  process.exit(1);
});
