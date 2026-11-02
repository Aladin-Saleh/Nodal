import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assistantConfigFiles,
  claudeCodeProjects,
  rewriteServerPath,
  updateAssistantConfigs,
} from '../../src/main/mcp-config-update';
import { useTempDir } from '../helpers/temp-dir';

const tempDir = useTempDir();

const ROOT = 'C:\\Users\\ada\\AppData\\Local\\Nodal';
const STABLE = 'C:\\Users\\ada\\AppData\\Roaming\\Nodal\\mcp\\nodal-mcp.cjs';
const OLD = `${ROOT}\\app-1.4.0\\resources\\nodal-mcp.cjs`;
const BASE = 'C:\\Users\\ada\\Documents\\Base.nodal';

describe('rewriteServerPath', () => {
  it('remplace le chemin versionné dans un JSON, en gardant le reste', () => {
    const text = JSON.stringify(
      {
        mcpServers: {
          nodal: { command: 'node', args: [OLD, BASE, '--read-only'] },
          autre: { command: 'node', args: ['C:\\outil\\serveur.cjs'] },
        },
      },
      null,
      2,
    );
    const next = rewriteServerPath(text, ROOT, STABLE);
    expect(JSON.parse(next)).toEqual({
      mcpServers: {
        nodal: { command: 'node', args: [STABLE, BASE, '--read-only'] },
        autre: { command: 'node', args: ['C:\\outil\\serveur.cjs'] },
      },
    });
  });

  it('gère le TOML de Codex, les barres obliques et la casse', () => {
    const toml = `[mcp_servers.nodal]\ncommand = "node"\nargs = ["${OLD.replaceAll('\\', '\\\\')}", "x"]\n`;
    expect(rewriteServerPath(toml, ROOT, STABLE)).toBe(
      `[mcp_servers.nodal]\ncommand = "node"\nargs = ["${STABLE.replaceAll('\\', '\\\\')}", "x"]\n`,
    );
    const slashes = OLD.replaceAll('\\', '/').toLowerCase();
    expect(rewriteServerPath(`node ${slashes}`, ROOT, STABLE)).toBe(
      `node ${STABLE.replaceAll('\\', '/')}`,
    );
    expect(rewriteServerPath(`node "${OLD}"`, ROOT, STABLE)).toBe(
      `node "${STABLE}"`,
    );
  });

  it('ne touche pas aux chemins d’une autre installation ou d’un autre fichier', () => {
    const others = [
      'D:\\Autre\\Nodal\\app-1.4.0\\resources\\nodal-mcp.cjs',
      `${ROOT}\\app-1.4.0\\resources\\app.asar`,
      STABLE,
    ].join('\n');
    expect(rewriteServerPath(others, ROOT, STABLE)).toBe(others);
  });
});

describe('updateAssistantConfigs', () => {
  it('réécrit seulement les fichiers concernés', () => {
    const dir = tempDir();
    const concerned = path.join(dir, 'claude_desktop_config.json');
    const untouched = path.join(dir, 'settings.json');
    fs.writeFileSync(concerned, JSON.stringify({ args: [OLD] }));
    fs.writeFileSync(untouched, '{ "theme": "dark" }');
    const before = fs.statSync(untouched).mtimeMs;

    expect(
      updateAssistantConfigs(
        [concerned, untouched, path.join(dir, 'absent.json')],
        ROOT,
        STABLE,
      ),
    ).toEqual([concerned]);
    expect(JSON.parse(fs.readFileSync(concerned, 'utf8'))).toEqual({
      args: [STABLE],
    });
    expect(fs.statSync(untouched).mtimeMs).toBe(before);
    expect(fs.readdirSync(dir).toSorted()).toEqual([
      'claude_desktop_config.json',
      'settings.json',
    ]);
  });
});

describe('fichiers examinés', () => {
  it('liste les configurations globales et celles des projets, sans doublon', () => {
    const files = assistantConfigFiles({
      home: 'H',
      appData: 'A',
      projectDirs: ['P', 'p'],
    });
    expect(files).toContain(path.join('H', '.claude.json'));
    expect(files).toContain(path.join('H', '.codex', 'config.toml'));
    expect(files).toContain(
      path.join('A', 'Claude', 'claude_desktop_config.json'),
    );
    expect(files).toContain(path.join('P', '.vscode', 'mcp.json'));
    expect(files.filter((file) => file.endsWith('.mcp.json'))).toHaveLength(1);
  });

  it('retrouve les projets de Claude Code', () => {
    const home = tempDir();
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({ projects: { 'C:/dev/a': {}, 'C:/dev/b': {} } }),
    );
    expect(claudeCodeProjects(home)).toEqual(['C:/dev/a', 'C:/dev/b']);
    expect(claudeCodeProjects(path.join(home, 'vide'))).toEqual([]);
  });
});
