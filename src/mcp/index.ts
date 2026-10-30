/**
 * Point d'entrée du serveur MCP (stdio), exécuté par Node.js ≥ 22.13 :
 *
 *   node nodal-mcp.cjs "C:\chemin\vers\espace.nodal" [--read-only]
 *
 * Il n'est pas lancé par l'exécutable Electron : sous Windows, le processus
 * principal d'Electron écrit une ligne vide sur stdout au démarrage, ce qui
 * corromprait le flux JSON-RPC.
 */
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createNodalMcpServer } from './server';

declare const NODAL_VERSION: string;

const USAGE = 'Usage : node nodal-mcp.cjs <fichier.nodal> [--read-only]';

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
  // stdout est réservé au protocole : tout diagnostic part sur stderr.
  console.log = console.error;
  const server = createNodalMcpServer({
    workspaceFile: path.resolve(file),
    version: NODAL_VERSION,
    readOnly,
  });
  await server.connect(new StdioServerTransport());
  console.error(
    `[nodal-mcp] prêt (${readOnly ? 'lecture seule' : 'lecture et écriture'}) : ${path.resolve(file)}`,
  );
}

main().catch((error: unknown) => {
  console.error('[nodal-mcp] échec du démarrage', error);
  process.exit(1);
});
