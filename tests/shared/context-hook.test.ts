import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installContextHook } from '../../src/main/context-hook-install';
import {
  contextHookCommand,
  withContextHook,
} from '../../src/shared/context-hook';
import { useTempDir } from '../helpers/temp-dir';

const tempDir = useTempDir();
const command = contextHookCommand(
  'C:\\Users\\a\\.nodal\\nodal-mcp.cjs',
  'D:\\Notes\\Projet.nodal',
);

describe('withContextHook', () => {
  it('donne la commande du serveur en mode contexte', () => {
    expect(command).toBe(
      'node "C:\\Users\\a\\.nodal\\nodal-mcp.cjs" "D:\\Notes\\Projet.nodal" --context',
    );
  });

  it('garde les autres réglages et hooks, remplace un ancien hook de Nodal', () => {
    const old = contextHookCommand('C:\\ancien\\nodal-mcp.cjs', 'x.nodal');
    const settings = withContextHook(
      {
        permissions: { allow: ['Bash(npm test)'] },
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'echo fin' }] }],
          UserPromptSubmit: [
            {
              hooks: [
                { type: 'command', command: 'echo autre' },
                { type: 'command', command: old },
              ],
            },
          ],
        },
      },
      'claude-code',
      command,
    );
    expect(settings).toEqual({
      permissions: { allow: ['Bash(npm test)'] },
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'echo fin' }] }],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'echo autre' }] },
          { hooks: [{ type: 'command', command, timeout: 10 }] },
        ],
        PreToolUse: [
          {
            matcher: 'Read|Edit|MultiEdit|Write|NotebookEdit|Bash|PowerShell',
            hooks: [{ type: 'command', command, timeout: 10 }],
          },
        ],
        SessionStart: [
          {
            matcher: 'compact',
            hooks: [{ type: 'command', command, timeout: 10 }],
          },
        ],
      },
    });
  });

  it('Gemini CLI : événement BeforeAgent, hook nommé', () => {
    expect(withContextHook(null, 'gemini-cli', command)).toEqual({
      hooks: {
        BeforeAgent: [
          {
            matcher: '*',
            hooks: [{ name: 'nodal-context', type: 'command', command }],
          },
        ],
      },
    });
  });
});

describe('installContextHook', () => {
  it('crée le fichier de réglages local du projet, puis le complète', () => {
    const dir = tempDir();
    const file = installContextHook(dir, 'claude-code', command);
    expect(file).toBe(path.join(dir, '.claude', 'settings.local.json'));
    const again = installContextHook(dir, 'claude-code', command);
    const written = JSON.parse(fs.readFileSync(again, 'utf8'));
    for (const event of ['UserPromptSubmit', 'PreToolUse', 'SessionStart'])
      expect(written.hooks[event]).toHaveLength(1);
  });

  it('refuse de réécrire un fichier illisible', () => {
    const dir = tempDir();
    const file = path.join(dir, '.gemini', 'settings.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, '{ cassé');
    expect(() => installContextHook(dir, 'gemini-cli', command)).toThrow(
      /JSON valide/,
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('{ cassé');
  });
});
