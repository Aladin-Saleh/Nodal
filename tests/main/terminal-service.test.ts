import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultShell,
  loadNodePty,
  TerminalService,
} from '../../src/main/terminal/terminal-service';
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

describe('defaultShell', () => {
  it('PowerShell sous Windows, $SHELL ailleurs', () => {
    expect(defaultShell('win32', { PATH: '' })).toBe('powershell.exe');
    expect(defaultShell('linux', { SHELL: '/bin/zsh' })).toBe('/bin/zsh');
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
      workspaceFile: () => 'C:\\notes\\Projet.nodal',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });
    const session = service.create({ cols: 80, rows: 24 });
    expect(session).toMatchObject({ id: '1', cwd });
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
});
