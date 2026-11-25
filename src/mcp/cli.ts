/**
 * Mode commande : les mêmes outils que le serveur MCP, lancés d'un terminal
 * ou d'un script (« code mode » : plusieurs appels en un tour, résultats
 * filtrés avant d'atteindre l'assistant).
 *
 *   node nodal-mcp.cjs <fichier> search capture rapide -- files src/a.ts
 */
import {
  InMemoryTransport,
  type JSONRPCMessage,
  type McpServer,
} from '@modelcontextprotocol/server';

export const CLI_USAGE = `Commandes (plusieurs : séparées par --) :
  search <mots>           files <chemins>      node <id>
  doc <id> [offset]       impact <id|chemins>  path <id> <id>
  tree [id]               health               lessons [mots]
  apply                   opérations JSON sur stdin ({"operations":[…]} ou […])
  call <outil> <json>     tout autre outil`;

export interface CliCall {
  tool: string;
  args: Record<string, unknown>;
}

/** Identifiant (préfixe hexadécimal) plutôt qu'un chemin de fichier. */
const isId = (value: string) => /^[0-9a-f]{8}[0-9a-f-]*$/i.test(value);

/** Une commande en appel d'outil ; lève une erreur lisible sinon. */
export function parseCommand(
  words: readonly string[],
  stdin: () => string,
): CliCall {
  const [command, ...rest] = words;
  const need = (count: number) => {
    if (rest.length < count)
      throw new Error(`« ${command} » : argument manquant.\n\n${CLI_USAGE}`);
  };
  switch (command) {
    case 'search':
      need(1);
      return { tool: 'nodal_search', args: { query: rest.join(' ') } };
    case 'files':
      need(1);
      return { tool: 'nodal_for_files', args: { paths: rest } };
    case 'node':
      need(1);
      return { tool: 'nodal_get_node', args: { id: rest[0] } };
    case 'doc':
      need(1);
      return {
        tool: 'nodal_read_document',
        args: { id: rest[0], offset: Number(rest[1] ?? 0) },
      };
    case 'impact':
      need(1);
      return {
        tool: 'nodal_impact',
        args: isId(rest[0]!) ? { nodeId: rest[0] } : { paths: rest },
      };
    case 'path':
      need(2);
      return {
        tool: 'nodal_path',
        args: { fromId: rest[0], toId: rest[1], includeHierarchy: true },
      };
    case 'tree':
      return { tool: 'nodal_tree', args: rest[0] ? { rootId: rest[0] } : {} };
    case 'health':
      return { tool: 'nodal_health', args: {} };
    case 'lessons':
      return {
        tool: 'nodal_lessons',
        args: rest.length > 0 ? { query: rest.join(' ') } : {},
      };
    case 'apply': {
      const input: unknown = JSON.parse(stdin());
      return {
        tool: 'nodal_apply',
        args: Array.isArray(input)
          ? { operations: input }
          : (input as Record<string, unknown>),
      };
    }
    case 'call':
      need(1);
      return {
        tool: rest[0]!,
        args: JSON.parse(rest[1] ?? '{}') as Record<string, unknown>,
      };
    default:
      throw new Error(`Commande inconnue : ${command ?? ''}\n\n${CLI_USAGE}`);
  }
}

/** Commandes séparées par `--`. */
export function splitCommands(words: readonly string[]): string[][] {
  const commands: string[][] = [[]];
  for (const word of words) {
    if (word === '--') commands.push([]);
    else commands.at(-1)!.push(word);
  }
  return commands.filter((command) => command.length > 0);
}

/**
 * Exécute des appels sur le serveur, en mémoire, dans l'ordre. Renvoie leur
 * texte et si l'un a échoué.
 */
export async function runCalls(
  server: McpServer,
  calls: readonly CliCall[],
  version: string,
): Promise<{ text: string; failed: boolean }> {
  const [client, transport] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: JSONRPCMessage) => void>();
  // API du transport MCP : un seul gestionnaire, par affectation.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  client.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number')
      pending.get(message.id)?.(message);
  };
  await server.connect(transport);
  await client.start();
  let nextId = 1;
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) => {
        if ('error' in message) reject(new Error(message.error.message));
        else resolve((message as { result: Record<string, unknown> }).result);
      });
      void client.send({ jsonrpc: '2.0', id, method, params });
    });
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'nodal-cli', version },
  });
  await client.send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const parts: string[] = [];
  let failed = false;
  try {
    for (const { tool, args } of calls) {
      const result = (await request('tools/call', {
        name: tool,
        arguments: args,
      })) as { content?: { text?: string }[]; isError?: boolean };
      if (result.isError) failed = true;
      parts.push(
        (result.content ?? []).map((item) => item.text ?? '').join('\n\n'),
      );
    }
  } finally {
    await server.close();
  }
  return { text: parts.join('\n\n=====\n\n'), failed };
}
