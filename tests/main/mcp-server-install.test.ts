import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  installMcpServer,
  MCP_SERVER_FILE_NAME,
} from '../../src/main/mcp-server-install';
import { listFiles, useTempDir } from '../helpers/temp-dir';

const tempDir = useTempDir();

function setup() {
  const resources = path.join(tempDir(), 'app-1.5.0', 'resources');
  fs.mkdirSync(resources, { recursive: true });
  const source = path.join(resources, MCP_SERVER_FILE_NAME);
  fs.writeFileSync(source, 'serveur v1');
  return { source, target: path.join(tempDir(), 'userData', 'mcp') };
}

describe('installMcpServer', () => {
  it('copie le serveur vers le chemin stable et renvoie ce chemin', () => {
    const { source, target } = setup();
    const installed = installMcpServer(source, target);
    expect(installed).toBe(path.join(target, MCP_SERVER_FILE_NAME));
    expect(fs.readFileSync(installed, 'utf8')).toBe('serveur v1');
  });

  it('remplace une ancienne version, sans fichier temporaire restant', () => {
    const { source, target } = setup();
    installMcpServer(source, target);
    fs.writeFileSync(source, 'serveur v2');
    const installed = installMcpServer(source, target);
    expect(fs.readFileSync(installed, 'utf8')).toBe('serveur v2');
    expect(listFiles(target)).toEqual([MCP_SERVER_FILE_NAME]);
  });

  it('renvoie le chemin d’origine si la copie échoue', () => {
    const { source } = setup();
    const blocker = path.join(tempDir(), 'fichier');
    fs.writeFileSync(blocker, '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(installMcpServer(source, path.join(blocker, 'mcp'))).toBe(source);
    error.mockRestore();
  });
});
