import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadNodePty,
  TerminalService,
} from '../../src/main/terminal/terminal-service';
import {
  changeDirectoryInput,
  detectShells,
  parseWslDistros,
} from '../../src/main/terminal/shells';
import type { TerminalEvent } from '../../src/shared/terminal';

let service: TerminalService | null = null;
afterEach(() => service?.closeAll());

/** Attend un événement qui satisfait `test` (5 s au plus). */
function waitFor(
  events: TerminalEvent[],
  test: (events: TerminalEvent[]) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (test(events)) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 15_000) {
        clearInterval(timer);
        reject(new Error('délai dépassé'));
      }
    }, 50);
  });
}

const output = (events: TerminalEvent[]) =>
  events.map((event) => (event.kind === 'data' ? event.data : '')).join('');

describe('detectShells', () => {
  const env = {
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\pwsh;C:\\Git\\mingw64\\bin',
  };
  const ids = (files: string[], distros: string[] = []) =>
    detectShells('win32', env, distros, (file) => files.includes(file)).map(
      ({ id }) => id,
    );

  it('PowerShell et l’invite de commandes toujours proposés sous Windows', () => {
    expect(ids([], ['Ubuntu'])).toEqual(['powershell', 'cmd']);
  });

  it('PowerShell 7, Git Bash et les distributions WSL s’ils sont installés', () => {
    expect(
      ids(
        [
          'C:\\pwsh\\pwsh.exe',
          'C:\\Git\\mingw64\\bin\\git.exe',
          'C:\\Git\\bin\\bash.exe',
          'C:\\Windows\\System32\\wsl.exe',
        ],
        ['Ubuntu'],
      ),
    ).toEqual(['pwsh', 'powershell', 'cmd', 'git-bash', 'wsl:Ubuntu']);
  });

  it('$SHELL d’abord ailleurs', () => {
    expect(
      detectShells('linux', { SHELL: '/bin/zsh' }, [], () => true)[0],
    ).toMatchObject({ id: 'zsh', file: '/bin/zsh', args: [] });
  });
});

/** Réponse de `reg query` pour une distribution. */
const line = (name: string) =>
  `HKEY_CURRENT_USER\\Lxss\\{1}\r\n    DistributionName    REG_SZ    ${name}\r\n\r\n`;

describe('parseWslDistros', () => {
  it('lit le registre, sans Docker ni nom qui serait une option', () => {
    expect(
      parseWslDistros(
        ['docker-desktop', 'Ubuntu-24.04', '--exec'].map(line).join(''),
      ),
    ).toEqual(['Ubuntu-24.04']);
    expect(parseWslDistros('')).toEqual([]);
  });
});

describe('changeDirectoryInput', () => {
  it('écrit la commande cd propre à chaque shell, chemin protégé', () => {
    const folder = String.raw`C:\dev\l'api`;
    expect(changeDirectoryInput('powershell', folder)).toBe(
      String.raw`${'\x1b'}Set-Location -LiteralPath 'C:\dev\l''api'` + '\r',
    );
    expect(changeDirectoryInput('cmd', folder)).toBe(
      String.raw`${'\x1b'}cd /d "C:\dev\l'api"` + '\r',
    );
    expect(changeDirectoryInput('git-bash', folder)).toBe(
      String.raw`${'\x15'}cd '/c/dev/l'\''api'` + '\r',
    );
    expect(changeDirectoryInput('wsl:Ubuntu', String.raw`C:\dev`)).toBe(
      String.raw`${'\x15'}cd "$(wslpath 'C:\dev')"` + '\r',
    );
    expect(changeDirectoryInput('bash', '/home/a b')).toBe(
      "\x15cd '/home/a b'\r",
    );
  });
});

describe('TerminalService', () => {
  it('exécute une commande dans le dossier donné, avec NODAL_WORKSPACE', async () => {
    const events: TerminalEvent[] = [];
    const cwd = os.tmpdir();
    service = new TerminalService({
      pty: () => loadNodePty(null),
      emit: (event) => events.push(event),
      cwd: () => cwd,
      folders: () => [],
      workspaceFile: () => 'C:\\notes\\Projet.nodal',
      shells: () => [
        { id: 'absent', name: 'Absent', file: 'absent.exe', args: [] },
        {
          id: 'test',
          name: 'Shell de test',
          file: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
          args: [],
        },
      ],
    });
    const session = await service.create({
      cols: 80,
      rows: 24,
      shell: 'test',
    });
    expect(session).toEqual({
      id: '1',
      shell: 'Shell de test',
      shellId: 'test',
      cwd,
    });
    expect(await service.listShells()).toContainEqual({
      id: 'test',
      name: 'Shell de test',
    });
    service.write(
      session.id,
      process.platform === 'win32'
        ? 'echo terminal-%NODAL_WORKSPACE%\r'
        : 'echo terminal-$NODAL_WORKSPACE\r',
    );
    await waitFor(events, (all) =>
      output(all).includes('terminal-C:\\notes\\Projet.nodal'),
    );
    service.resize(session.id, 100, 30);

    service.write(session.id, 'exit\r');
    await waitFor(events, (all) => all.some((event) => event.kind === 'exit'));
    expect(() => service!.write(session.id, 'x')).toThrow(/fermé/);
  }, 30_000);

  it('démarre dans un dossier de code choisi et s’y déplace, refuse les autres', async () => {
    const events: TerminalEvent[] = [];
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nodal-term-'));
    const [api, web] = ['api-repo', 'web-repo'].map((name) => {
      const dir = path.join(base, name);
      fs.mkdirSync(dir);
      return dir;
    }) as [string, string];
    const windows = process.platform === 'win32';
    service = new TerminalService({
      pty: () => loadNodePty(null),
      emit: (event) => events.push(event),
      cwd: () => os.tmpdir(),
      folders: () => [api, web],
      workspaceFile: () => null,
      shells: () => [
        windows
          ? { id: 'cmd', name: 'cmd', file: 'cmd.exe', args: [] }
          : { id: 'sh', name: 'sh', file: '/bin/sh', args: [] },
      ],
    });
    const session = await service.create({ cols: 80, rows: 24, folder: web });
    expect(session.cwd).toBe(web);
    expect(
      (await service.create({ cols: 80, rows: 24, folder: base })).cwd,
    ).toBe(os.tmpdir());

    expect(service.changeDirectory(session.id, api)).toBe(api);
    service.write(session.id, windows ? 'echo at-%CD%\r' : 'echo at-$PWD\r');
    await waitFor(events, (all) => output(all).includes(`at-${api}`));
    expect(() => service!.changeDirectory(session.id, base)).toThrow(
      /dossier de code/,
    );
    service.closeAll();
    // Shells arrêtés : leur dossier se libère après un court délai.
    fs.rmSync(base, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }, 30_000);
});
