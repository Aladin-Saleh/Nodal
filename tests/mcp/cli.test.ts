import { beforeEach, describe, expect, it } from 'vitest';
import { NodeService } from '../../src/main/knowledge/node-service';
import { parseCommand, runCalls, splitCommands } from '../../src/mcp/cli';
import { createNodalMcpServer } from '../../src/mcp/server';
import { testWorkspaceFixture } from '../helpers/test-workspace';

const workspace = testWorkspaceFixture();
let file: string;
const none = () => '';
const run = (line: string, readOnly = false, stdin = none) =>
  runCalls(
    createNodalMcpServer({ workspaceFile: file, version: 'test', readOnly }),
    splitCommands(line.split(' ')).map((words) => parseCommand(words, stdin)),
    'test',
  );

beforeEach(() => {
  const { context, service } = workspace();
  file = service.getCurrent()!.filePath;
  new NodeService(context).create({
    parentId: null,
    title: 'Serveur MCP',
    nodeType: 'component',
  });
});

describe('mode commande', () => {
  it('traduit les commandes en appels', () => {
    const call = (line: string) => parseCommand(line.split(' '), none);
    expect(call('search a b').args).toEqual({ query: 'a b' });
    expect(call('impact 1234abcd').args).toEqual({ nodeId: '1234abcd' });
    expect(call('impact src/a.ts').args).toEqual({ paths: ['src/a.ts'] });
    expect(call('doc 1234abcd 50').args).toEqual({
      id: '1234abcd',
      offset: 50,
    });
    expect(() => call('search')).toThrow(/argument manquant/);
    expect(() => call('efface')).toThrow(/Commande inconnue/);
    expect(splitCommands(['a', 'b', '--', 'c'])).toEqual([['a', 'b'], ['c']]);
  });

  it('enchaîne plusieurs commandes, dit si l’une échoue', async () => {
    const ok = await run('search serveur -- tree');
    expect(ok.failed).toBe(false);
    expect(ok.text.split('=====')).toHaveLength(2);
    expect(ok.text).toContain('Serveur MCP');
    expect((await run('node absent00')).failed).toBe(true);
  });

  it('écrit par apply, sauf en lecture seule', async () => {
    const stdin = () =>
      JSON.stringify([{ op: 'createNode', title: 'Kafka', type: 'component' }]);
    const written = await run('apply', false, stdin);
    expect(written).toMatchObject({ failed: false });
    expect((await run('search kafka')).text).toContain('Kafka');
    await expect(run('apply', true, stdin)).resolves.toMatchObject({
      failed: true,
    });
  });
});
