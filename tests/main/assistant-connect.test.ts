import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  connectAssistant,
  withCodexServer,
  type ConnectOptions,
} from '../../src/main/assistant-connect';
import { installNode } from '../../src/main/node-install';
import { contextHookCommand } from '../../src/shared/context-hook';
import { useTempDir } from '../helpers/temp-dir';

const tempDir = useTempDir();

const NODE = 'C:\\Users\\Moi\\mcp\\node.exe';
const SERVER = 'C:\\Users\\Moi\\mcp\\nodal-mcp.cjs';
const BASE = 'C:\\Docs\\kb.nodal';

function setup(client: ConnectOptions['client'], allowWrites = true) {
  const root = tempDir();
  const project = path.join(root, 'projet');
  fs.mkdirSync(project, { recursive: true });
  const options: ConnectOptions = {
    client,
    projectDir: ['codex', 'claude-desktop'].includes(client) ? null : project,
    home: path.join(root, 'home'),
    appData: path.join(root, 'appdata'),
    nodePath: NODE,
    serverPath: SERVER,
    workspaceFile: BASE,
    allowWrites,
  };
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const json = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { root, project, options, write, json };
}

const ENTRY = { command: NODE, args: [SERVER, BASE] };

describe('connectAssistant', () => {
  it('Claude Code : serveur accepté, hook, skills, hors de git', () => {
    const { project, options, write, json } = setup('claude-code');
    const settings = path.join(project, '.claude', 'settings.local.json');
    write(settings, '{"model":"x","disabledMcpjsonServers":["nodal","b"]}');
    write(path.join(project, '.git', 'info', 'exclude'), '# à moi');
    for (let i = 0; i < 2; i++) {
      expect(connectAssistant(options).note).toBeNull();
      expect(json(path.join(project, '.mcp.json'))).toEqual({
        mcpServers: { nodal: ENTRY },
      });
      expect(json(settings)).toMatchObject({
        model: 'x',
        enabledMcpjsonServers: ['nodal'],
        disabledMcpjsonServers: ['b'],
      });
      expect(json(settings).hooks.UserPromptSubmit).toHaveLength(1);
      expect(
        fs.existsSync(
          path.join(project, '.claude', 'skills', 'nodal-scan', 'SKILL.md'),
        ),
      ).toBe(true);
      // Les réglages existaient : seul le fichier créé est exclu.
      expect(
        fs.readFileSync(path.join(project, '.git', 'info', 'exclude'), 'utf8'),
      ).toBe('# à moi\n/.mcp.json\n');
    }
  });

  it('signale un serveur ajouté à la main, qui prime', () => {
    const { project, options, write } = setup('claude-code');
    write(
      path.join(options.home, '.claude.json'),
      JSON.stringify({
        projects: { [project]: { mcpServers: { nodal: {} } } },
      }),
    );
    expect(connectAssistant(options).note).toContain('claude mcp remove');
  });

  it('garde les autres serveurs et réglages', () => {
    const { project, options, write, json } = setup('gemini-cli', false);
    const file = path.join(project, '.gemini', 'settings.json');
    write(file, '\uFEFF{"theme":"x","mcpServers":{"autre":{"command":"a"}}}');
    connectAssistant(options);
    expect(json(file)).toMatchObject({
      theme: 'x',
      mcpServers: {
        autre: { command: 'a' },
        nodal: { command: NODE, args: [SERVER, BASE, '--read-only'] },
      },
      hooks: { BeforeAgent: [{ matcher: '*' }] },
    });
    expect(
      fs.existsSync(path.join(project, '.agents', 'skills', 'nodal')),
    ).toBe(true);
  });

  it('VS Code, Cursor, Claude Desktop : leur fichier', () => {
    const vscode = setup('vscode');
    connectAssistant(vscode.options);
    expect(
      vscode.json(path.join(vscode.project, '.vscode', 'mcp.json')),
    ).toEqual({ servers: { nodal: { type: 'stdio', ...ENTRY } } });
    const cursor = setup('cursor');
    connectAssistant(cursor.options);
    expect(
      cursor.json(path.join(cursor.project, '.cursor', 'mcp.json')),
    ).toEqual({ mcpServers: { nodal: ENTRY } });
    const desktop = setup('claude-desktop');
    expect(connectAssistant(desktop.options).files).toEqual([
      path.join(
        desktop.options.appData,
        'Claude',
        'claude_desktop_config.json',
      ),
    ]);
  });

  it('n’écrit rien si un fichier est illisible', () => {
    const { project, options, write } = setup('claude-code');
    const file = path.join(project, '.claude', 'settings.local.json');
    write(file, '{ // commentaire\n}');
    expect(() => connectAssistant(options)).toThrow(/format inattendu/);
    expect(fs.readdirSync(project)).toEqual(['.claude']);
    expect(fs.readdirSync(path.join(project, '.claude'))).toEqual([
      'settings.local.json',
    ]);
  });
});

describe('Codex', () => {
  const entry = { command: 'C:\\n.exe', args: ['a b'] };
  const table =
    '[mcp_servers.nodal]\ncommand = "C:\\\\n.exe"\nargs = ["a b"]\n';

  it('ajoute la table, la remplace, garde le reste', () => {
    expect(withCodexServer('', entry)).toBe(table);
    expect(withCodexServer('model = "x"\n', entry)).toBe(
      `model = "x"\n\n${table}`,
    );
    const old =
      'model = "x"\n\n[mcp_servers.nodal]\ncommand = "vieux"\n\n[autre]\na = 1\n';
    expect(withCodexServer(old, entry)).toBe(
      `model = "x"\n\n${table}\n[autre]\na = 1\n`,
    );
    expect(withCodexServer(table, entry)).toBe(table);
  });

  it('refuse une autre écriture du même serveur', () => {
    expect(
      withCodexServer('[mcp_servers]\nnodal = { command = "x" }\n', entry),
    ).toBeNull();
    // Un chemin qui contient le nom n'en est pas une.
    expect(
      withCodexServer('[mcp_servers.x]\ncommand = "C:/nodal/x"\n', entry),
    ).toMatch(/\[mcp_servers\.nodal\]/);
  });
});

it('commande du hook : Node nu, ou entre guillemets', () => {
  expect(contextHookCommand('s', 'b')).toBe('node "s" "b" --context');
  expect(contextHookCommand('s', 'b', NODE)).toBe(
    'C:/Users/Moi/mcp/node.exe "s" "b" --context',
  );
  const spaced = 'C:\\Users\\Jean Paul\\node.exe';
  expect(contextHookCommand('s', 'b', spaced)).toBe(
    '"C:/Users/Jean Paul/node.exe" "s" "b" --context',
  );
  expect(contextHookCommand('s', 'b', spaced, 'gemini-cli')).toMatch(/^& "/);
});

it('installNode : copie, remplace à une nouvelle version, sinon node', () => {
  const source = tempDir();
  const target = path.join(tempDir(), 'mcp');
  expect(installNode(source, target, 'win32')).toBe('node');
  const release = (version: string) => {
    fs.writeFileSync(path.join(source, 'node.exe'), version);
    fs.writeFileSync(path.join(source, 'version'), version);
    return installNode(source, target, 'win32');
  };
  for (const version of ['v1', 'v2', 'v2']) {
    expect(release(version)).toBe(path.join(target, 'node.exe'));
    expect(fs.readFileSync(path.join(target, 'node.exe'), 'utf8')).toBe(
      version,
    );
    expect(fs.readdirSync(target).toSorted()).toEqual(['node.exe', 'version']);
  }
});
