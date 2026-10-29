import { describe, expect, it } from 'vitest';
import { WORKSPACE_NAME_MAX_LENGTH } from '../../src/shared/domain';
import { IPC_CHANNELS } from '../../src/shared/ipc-contract';
import {
  createWorkspaceInputSchema,
  ipcArgsSchemas,
  workspaceNameSchema,
} from '../../src/shared/ipc-schemas';

describe('workspaceNameSchema', () => {
  it('normalise les espaces en début et fin', () => {
    expect(workspaceNameSchema.parse('  Base infra  ')).toBe('Base infra');
  });

  it.each([
    ['vide', ''],
    ['blanc', '   '],
    ['trop long', 'x'.repeat(WORKSPACE_NAME_MAX_LENGTH + 1)],
    ['caractère de contrôle', 'Base\u0000infra'],
    ['retour à la ligne', 'Base\ninfra'],
    ['non chaîne', 42],
  ])('refuse un nom %s', (_label, value) => {
    expect(workspaceNameSchema.safeParse(value).success).toBe(false);
  });

  it('accepte les accents et la longueur maximale', () => {
    expect(workspaceNameSchema.safeParse('Équipe données — été').success).toBe(
      true,
    );
    expect(
      workspaceNameSchema.safeParse('x'.repeat(WORKSPACE_NAME_MAX_LENGTH))
        .success,
    ).toBe(true);
  });
});

describe('createWorkspaceInputSchema', () => {
  it('refuse toute propriété inconnue (pas de chemin depuis le renderer)', () => {
    expect(
      createWorkspaceInputSchema.safeParse({ name: 'KB', filePath: 'C:/x' })
        .success,
    ).toBe(false);
  });
});

describe('ipcArgsSchemas', () => {
  it('couvre chaque canal du contrat', () => {
    expect(Object.keys(ipcArgsSchemas).toSorted()).toEqual(
      Object.values(IPC_CHANNELS).toSorted(),
    );
  });

  it('les canaux sans paramètre refusent tout argument', () => {
    for (const channel of [
      'app:getInfo',
      'workspace:open',
      'workspace:close',
      'workspace:getCurrent',
    ] as const) {
      expect(ipcArgsSchemas[channel].safeParse([]).success).toBe(true);
      expect(ipcArgsSchemas[channel].safeParse(['x']).success).toBe(false);
    }
  });
});
