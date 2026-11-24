import {
  InMemoryTransport,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';
import { createNodalMcpServer } from '../../src/mcp/server';

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** Client JSON-RPC minimal relié au serveur en mémoire. */
export async function connect(
  workspaceFile: string,
  readOnly = true,
  projectRoot: string | null = null,
  allTools = true,
) {
  const server = createNodalMcpServer({
    workspaceFile,
    version: 'test',
    readOnly,
    allTools,
    projectRoot,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: JSONRPCMessage) => void>();
  // API du transport MCP : un seul gestionnaire, par affectation.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  clientSide.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') {
      pending.get(message.id)?.(message);
    }
  };
  await server.connect(serverSide);
  await clientSide.start();
  let nextId = 1;
  const request = (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, (message) => {
        if ('error' in message)
          reject(new Error(JSON.stringify(message.error)));
        else resolve((message as { result: Record<string, unknown> }).result);
      });
      void clientSide.send({ jsonrpc: '2.0', id, method, params });
    });
  };
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  await clientSide.send({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  return {
    init,
    listTools: () => request('tools/list', {}),
    listPrompts: () => request('prompts/list', {}),
    getPrompt: (name: string, args: Record<string, unknown>) =>
      request('prompts/get', { name, arguments: args }),
    call: async (name: string, args: Record<string, unknown> = {}) =>
      (await request('tools/call', {
        name,
        arguments: args,
      })) as unknown as ToolResult,
    close: () => server.close(),
  };
}
