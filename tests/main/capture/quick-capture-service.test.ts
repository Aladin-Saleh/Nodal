import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { QuickCaptureService } from '../../../src/main/capture/quick-capture-service';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import {
  captureToInbox,
  ensureInbox,
  findInbox,
} from '../../../src/main/knowledge/inbox-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { WorkspaceService } from '../../../src/main/workspace/workspace-service';
import type { RecentWorkspace } from '../../../src/shared/model';
import { INBOX_TITLE } from '../../../src/shared/quick-capture';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

describe('boîte de réception', () => {
  it('est créée à la première capture puis réutilisée', () => {
    const { context } = workspace();
    expect(findInbox(context())).toBeNull();

    const first = captureToInbox(context(), { title: 'Idée', note: null });
    const second = captureToInbox(context(), { title: 'Autre', note: null });

    expect(second.inboxId).toBe(first.inboxId);
    const nodes = new NodeService(context).list();
    const inbox = nodes.find((node) => node.id === first.inboxId)!;
    expect(inbox).toMatchObject({ title: INBOX_TITLE, parentId: null });
    expect(
      nodes
        .filter((node) => node.parentId === inbox.id)
        .map((node) => node.title),
    ).toEqual(['Idée', 'Autre']);
  });

  it('range la note dans un document Markdown', () => {
    const { context } = workspace();
    const { nodeId } = captureToInbox(context(), {
      title: 'Idée',
      note: 'Voir **ceci**',
    });
    const [document] = new NodeService(context).get(nodeId).documents;
    expect(document).toMatchObject({ title: 'Note', contentType: 'markdown' });
    expect(new DocumentService(context).get(document!.id).body).toBe(
      'Voir **ceci**',
    );
  });

  it('reprend une racine du même titre, puis en recrée une si elle est supprimée', () => {
    const { context } = workspace();
    const nodes = new NodeService(context);
    const existing = nodes.create({
      parentId: null,
      title: INBOX_TITLE,
      nodeType: 'generic',
    });
    expect(ensureInbox(context())).toBe(existing.id);

    nodes.delete({ id: existing.id, childrenStrategy: 'delete' });
    const recreated = ensureInbox(context());
    expect(recreated).not.toBe(existing.id);
    expect(findInbox(context())).toBe(recreated);
  });

  it('ne retient pas une boîte de réception rangée sous un autre nœud', () => {
    const { context } = workspace();
    const inbox = ensureInbox(context());
    const nodes = new NodeService(context);
    const parent = nodes.create({
      parentId: null,
      title: 'Archives',
      nodeType: 'generic',
    });
    nodes.move({ id: inbox, parentId: parent.id });
    expect(findInbox(context())).toBeNull();
  });
});

function recentOf(entries: Partial<RecentWorkspace>[]) {
  return {
    list: (): RecentWorkspace[] =>
      entries.map((entry) => ({
        id: 'r',
        name: 'KB',
        filePath: '',
        lastOpenedAt: '',
        exists: true,
        ...entry,
      })),
  };
}

describe('QuickCaptureService', () => {
  it('range dans l’espace ouvert', () => {
    const { service, context } = workspace();
    const capture = new QuickCaptureService({
      workspaces: service,
      recent: recentOf([]),
    });
    expect(capture.target()).toEqual({
      workspaceName: 'Espace de test',
      open: true,
    });
    const result = capture.submit({ title: 'Idée', note: null });
    expect(result).toMatchObject({
      workspaceName: 'Espace de test',
      open: true,
    });
    expect(new NodeService(context).get(result.nodeId).title).toBe('Idée');
  });

  it('range dans le dernier espace récent sans l’ouvrir', () => {
    const { service, dir } = workspace();
    const filePath = path.join(dir, 'test.nodal');
    service.close();
    const closed = new WorkspaceService();
    const capture = new QuickCaptureService({
      workspaces: closed,
      recent: recentOf([
        {
          name: 'Disparu',
          filePath: path.join(dir, 'absent.nodal'),
          exists: false,
        },
        { name: 'Espace de test', filePath },
      ]),
    });

    expect(capture.target()).toEqual({
      workspaceName: 'Espace de test',
      open: false,
    });
    const result = capture.submit({ title: 'Hors app', note: 'note' });
    expect(result.open).toBe(false);
    expect(closed.getCurrent()).toBeNull();

    // Le fichier a bien reçu la capture.
    closed.open(filePath);
    try {
      const node = new NodeService(() => closed.getContext()).get(
        result.nodeId,
      );
      expect(node.title).toBe('Hors app');
      expect(node.path.map((step) => step.title)).toContain(INBOX_TITLE);
    } finally {
      closed.close();
    }
  });

  it('signale l’absence d’espace', () => {
    const capture = new QuickCaptureService({
      workspaces: new WorkspaceService(),
      recent: recentOf([]),
    });
    expect(capture.target()).toBeNull();
    expect(() => capture.submit({ title: 'x', note: null })).toThrowError(
      expect.objectContaining({ code: 'NO_WORKSPACE_OPEN' }),
    );
  });
});
