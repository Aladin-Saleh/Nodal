import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  nodeLinkInArgs,
  resolveNodeLink,
} from '../../src/main/node-link-handler';
import { NodeService } from '../../src/main/knowledge/node-service';
import { WorkspaceService } from '../../src/main/workspace/workspace-service';
import { buildNodeLink } from '../../src/shared/node-links';
import type { RecentWorkspace } from '../../src/shared/model';
import { testWorkspaceFixture } from '../helpers/test-workspace';

const workspace = testWorkspaceFixture();

const recentEntry = (filePath: string, id = 'r1'): RecentWorkspace => ({
  id,
  name: 'Autre',
  filePath,
  lastOpenedAt: '2026-11-27T10:00:00.000Z',
  exists: true,
});

describe('liens nodal:// reçus', () => {
  it('trouve le lien parmi les arguments de lancement', () => {
    expect(
      nodeLinkInArgs(['Nodal.exe', '--flag', 'NODAL://node/n1?espace=w1']),
    ).toBe('NODAL://node/n1?espace=w1');
    expect(nodeLinkInArgs(['Nodal.exe'])).toBeNull();
  });

  it('ouvre le nœud dans l’espace ouvert, ou dans l’espace récent qui le contient', () => {
    const { service, context, dir } = workspace();
    const info = service.getCurrent()!;
    const here = new NodeService(context).create({
      parentId: null,
      title: 'Ici',
      nodeType: 'concept',
    });

    // Second espace, fermé : seulement parmi les récents.
    const otherFile = path.join(dir, 'autre.nodal');
    const other = new WorkspaceService();
    const otherInfo = other.create(otherFile, 'Autre');
    const there = new NodeService(() => other.getContext()).create({
      parentId: null,
      title: 'Là-bas',
      nodeType: 'concept',
    });
    other.close();

    const sources = {
      current: () => ({ id: info.id, db: service.getDatabase() }),
      recent: () => [recentEntry(otherFile)],
    };
    expect(resolveNodeLink(buildNodeLink(here.id, info.id), sources)).toEqual({
      kind: 'node',
      nodeId: here.id,
      workspaceId: info.id,
      recentId: null,
    });
    expect(
      resolveNodeLink(buildNodeLink(there.id, otherInfo.id), sources),
    ).toEqual({
      kind: 'node',
      nodeId: there.id,
      workspaceId: otherInfo.id,
      recentId: 'r1',
    });
    // Sans espace précisé : cherché partout.
    expect(resolveNodeLink(`nodal://node/${there.id}`, sources)).toMatchObject({
      recentId: 'r1',
    });
    // Identifiant abrégé (8 caractères, comme ceux du serveur MCP).
    expect(
      resolveNodeLink(`nodal://node/${there.id.slice(0, 8)}`, sources),
    ).toEqual({
      kind: 'node',
      nodeId: there.id,
      workspaceId: otherInfo.id,
      recentId: 'r1',
    });
    // Le nœud n'est pas dans l'espace annoncé.
    expect(
      resolveNodeLink(buildNodeLink(there.id, info.id), sources),
    ).toMatchObject({ kind: 'missing' });
    expect(resolveNodeLink('nodal://node/inconnu-0', sources)).toMatchObject({
      kind: 'missing',
    });
    expect(resolveNodeLink('nodal://autre', sources)).toEqual({
      kind: 'missing',
      message: 'Lien Nodal invalide.',
    });
  });

  it('ignore un espace récent illisible ou disparu', () => {
    const { dir } = workspace();
    expect(
      resolveNodeLink('nodal://node/inconnu-0', {
        current: () => null,
        recent: () => [
          recentEntry(path.join(dir, 'absent.nodal')),
          recentEntry(path.join(dir, 'test.nodal'), 'r2'),
        ],
      }),
    ).toMatchObject({ kind: 'missing' });
  });

  it('refuse un préfixe qui désigne plusieurs nœuds', () => {
    const { service } = workspace();
    const db = service.getDatabase();
    const info = service.getCurrent()!;
    const nodes = new NodeService(() => service.getContext());
    for (const id of ['aaaaaaaa-1', 'aaaaaaaa-2']) {
      const { id: created } = nodes.create({
        parentId: null,
        title: id,
        nodeType: 'concept',
      });
      db.prepare('UPDATE node SET id = ? WHERE id = ?').run(id, created);
    }
    const sources = {
      current: () => ({ id: info.id, db }),
      recent: () => [],
    };
    expect(resolveNodeLink('nodal://node/aaaaaaaa', sources)).toMatchObject({
      kind: 'missing',
      message: expect.stringContaining('plusieurs nœuds'),
    });
    // Identifiant complet : jamais ambigu.
    expect(resolveNodeLink('nodal://node/aaaaaaaa-1', sources)).toMatchObject({
      kind: 'node',
      nodeId: 'aaaaaaaa-1',
    });
  });
});
