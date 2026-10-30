/**
 * Base partagée avec un assistant IA, de bout en bout : l'application est
 * ouverte pendant qu'un vrai processus `nodal-mcp.cjs` (Node.js, stdio) écrit
 * dans le même fichier ; l'affichage doit suivre, et l'écriture doit pouvoir
 * être annulée depuis la fenêtre « Activité IA ».
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from 'playwright-core';
import { decode as decodeToon } from '@toon-format/toon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const electronPath = createRequire(import.meta.url)(
  'electron',
) as unknown as string;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nodal-e2e-ia-'));
const userData = path.join(work, 'profil');
const workspaceFile = path.join(work, 'Partagé.nodal');

let app: ElectronApplication;
let page: Page;
let mcp: ChildProcessWithoutNullStreams;

/** Client JSON-RPC ligne à ligne sur le stdio du serveur MCP. */
function mcpClient(child: ChildProcessWithoutNullStreams) {
  const pending = new Map<number, (message: Record<string, any>) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line) as Record<string, any>;
    if (typeof message.id === 'number') pending.get(message.id)?.(message);
  });
  let nextId = 1;
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<Record<string, any>>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (message) =>
        message.error
          ? reject(new Error(JSON.stringify(message.error)))
          : resolve(message.result),
      );
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      );
    });
  return {
    async initialize() {
      await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'e2e-assistant', version: '1' },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
      );
    },
    async call(name: string, args: Record<string, unknown>) {
      const result = await request('tools/call', { name, arguments: args });
      if (result.isError) throw new Error(result.content?.[0]?.text);
      return decodeToon(result.content[0].text) as Record<string, any>;
    },
  };
}

beforeAll(async () => {
  app = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: root,
    env: { ...process.env, NODAL_E2E_USER_DATA: userData },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

afterAll(async () => {
  mcp?.kill();
  await app?.close().catch(() => undefined);
  fs.rmSync(work, { recursive: true, force: true });
});

describe('base partagée avec un assistant IA', () => {
  it('affiche en direct ce qu’écrit l’assistant, puis l’annule', async () => {
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath,
      })) as unknown as typeof dialog.showSaveDialog;
    }, workspaceFile);
    await page.getByLabel('Nom de l’espace').fill('Partagé');
    await page.getByRole('button', { name: 'Créer…' }).click();
    await page.getByText('Cet espace est vide.').waitFor();

    mcp = spawn(
      'node',
      [path.join(root, '.vite', 'build', 'nodal-mcp.cjs'), workspaceFile],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const client = mcpClient(mcp);
    await client.initialize();
    const created = await client.call('nodal_create_node', {
      title: 'Kafka',
      type: 'component',
      summary: 'Bus de messages.',
    });
    expect(created.path).toBe('Kafka');

    // Détecté par le main (data_version) puis rechargé par le renderer.
    await page.getByRole('treeitem', { name: 'Kafka' }).waitFor();
    await page.getByText('Espace mis à jour par l’assistant IA.').waitFor();

    await page.getByRole('button', { name: 'Activité IA' }).click();
    const activity = page.getByRole('dialog', {
      name: 'Activité de l’assistant IA',
    });
    await activity.getByText('Nœud créé : Kafka').waitFor();
    await activity.getByText(/e2e-assistant/).waitFor();
    await activity.getByRole('button', { name: 'Annuler' }).click();
    await activity.getByText(/annulée le/).waitFor();
    await activity.getByRole('button', { name: 'Fermer' }).click();
    await page.getByRole('treeitem', { name: 'Kafka' }).waitFor({
      state: 'detached',
    });

    // L'assistant voit aussitôt l'annulation.
    const search = await client.call('nodal_search', { query: 'kafka' });
    expect(search.nodeCount).toBe(0);
  });
});
