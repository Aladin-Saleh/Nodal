import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AttachmentService,
  guessMimeType,
} from '../../../src/main/knowledge/attachment-service';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { SettingsService } from '../../../src/main/knowledge/settings-service';
import { TagService } from '../../../src/main/knowledge/tag-service';
import { ATTACHMENT_MAX_SIZE_DEFAULT_BYTES } from '../../../src/shared/domain';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();
let nodes: NodeService;
let documents: DocumentService;
let tags: TagService;
let attachments: AttachmentService;
let settings: SettingsService;
let nodeId: string;

beforeEach(() => {
  const { context } = workspace();
  nodes = new NodeService(context);
  documents = new DocumentService(context);
  tags = new TagService(context);
  attachments = new AttachmentService(context);
  settings = new SettingsService(context);
  nodeId = nodes.create({
    parentId: null,
    title: 'Nœud',
    nodeType: 'component',
  }).id;
});

const writeFile = (name: string, content: string | Buffer) => {
  const filePath = path.join(workspace().dir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
};

describe('DocumentService', () => {
  it('crée des documents ordonnés de tout type', () => {
    documents.create({ nodeId, title: 'Notes', contentType: 'markdown' });
    documents.create({
      nodeId,
      title: 'Requête',
      contentType: 'code',
      language: 'sql',
    });
    documents.create({ nodeId, title: 'Config', contentType: 'json' });

    const listed = nodes.get(nodeId).documents;
    expect(
      listed.map((doc) => [doc.title, doc.contentType, doc.language]),
    ).toEqual([
      ['Notes', 'markdown', null],
      ['Requête', 'code', 'sql'],
      ['Config', 'json', null],
    ]);
  });

  it('réserve le langage aux documents de code', () => {
    expect(() =>
      documents.create({
        nodeId,
        title: 'MD',
        contentType: 'markdown',
        language: 'sql',
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    const md = documents.create({
      nodeId,
      title: 'MD',
      contentType: 'markdown',
    });
    expect(() => documents.update({ id: md.id, language: 'go' })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('conserve le contenu à l’identique (espaces, retours, JSON invalide)', () => {
    const doc = documents.create({
      nodeId,
      title: 'JSON',
      contentType: 'json',
    });
    const body = '  {\n\t"a": 1,,\r\n  "é": " "\n}\n\n';
    documents.update({ id: doc.id, body });
    expect(documents.get(doc.id).body).toBe(body);
  });

  it('modifie le titre sans toucher au contenu', () => {
    const doc = documents.create({
      nodeId,
      title: 'Avant',
      contentType: 'text',
    });
    documents.update({ id: doc.id, body: 'texte' });
    const updated = documents.update({ id: doc.id, title: 'Après' });
    expect(updated).toMatchObject({ title: 'Après', body: 'texte' });
  });

  it('réordonne les documents et refuse une liste incomplète', () => {
    const a = documents.create({ nodeId, title: 'A', contentType: 'text' });
    const b = documents.create({ nodeId, title: 'B', contentType: 'text' });
    const c = documents.create({ nodeId, title: 'C', contentType: 'text' });

    documents.reorder({ nodeId, orderedIds: [c.id, a.id, b.id] });
    expect(nodes.get(nodeId).documents.map((doc) => doc.title)).toEqual([
      'C',
      'A',
      'B',
    ]);

    for (const orderedIds of [
      [a.id, b.id],
      [a.id, b.id, b.id],
      [a.id, b.id, 'x'],
    ]) {
      expect(() => documents.reorder({ nodeId, orderedIds })).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ERROR' }),
      );
    }
  });

  it('refuse un nœud inexistant et un document inconnu', () => {
    expect(() =>
      documents.create({ nodeId: 'inconnu', title: 'X', contentType: 'text' }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => documents.get('inconnu')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('supprime un document', () => {
    const doc = documents.create({ nodeId, title: 'A', contentType: 'text' });
    documents.delete(doc.id);
    expect(nodes.get(nodeId).documents).toEqual([]);
  });
});

describe('TagService', () => {
  it('crée, renomme et liste les tags avec leur usage', () => {
    const tag = tags.create({ name: 'Infra', color: '#00ff00' });
    nodes.setTags({ id: nodeId, tagIds: [tag.id] });
    expect(tags.list()).toEqual([
      { id: tag.id, name: 'Infra', color: '#00ff00', usageCount: 1 },
    ]);
    expect(tags.update({ id: tag.id, name: 'Infrastructure' }).name).toBe(
      'Infrastructure',
    );
  });

  it('refuse un nom déjà utilisé, sans tenir compte de la casse', () => {
    const tag = tags.create({ name: 'infra' });
    tags.create({ name: 'data' });
    expect(() => tags.create({ name: 'INFRA' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    expect(() => tags.update({ id: tag.id, name: 'Data' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    // Changer seulement la casse de son propre nom est permis.
    expect(tags.update({ id: tag.id, name: 'Infra' }).name).toBe('Infra');
  });

  it('supprimer un tag le retire des nœuds sans supprimer les nœuds', () => {
    const tag = tags.create({ name: 'temp' });
    nodes.setTags({ id: nodeId, tagIds: [tag.id] });
    tags.delete(tag.id);
    expect(nodes.get(nodeId).tags).toEqual([]);
    expect(nodes.list()).toHaveLength(1);
  });
});

describe('AttachmentService', () => {
  it('importe des fichiers en BLOB avec taille, empreinte et type', () => {
    const content = Buffer.from([0, 1, 2, 255, 254]);
    const [png] = attachments.addFromPaths(nodeId, [
      writeFile('image.png', content),
    ]);

    expect(png).toMatchObject({
      nodeId,
      fileName: 'image.png',
      mimeType: 'image/png',
      sizeBytes: 5,
    });
    expect(png!.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(attachments.getData(png!.id).data).equals(content)).toBe(
      true,
    );
  });

  it('refuse un fichier trop volumineux, et n’importe alors aucun fichier', () => {
    settings.update({ attachmentMaxSizeBytes: 1024 * 1024 });
    const small = writeFile('petit.txt', 'ok');
    const big = writeFile('gros.bin', Buffer.alloc(1024 * 1024 + 1));

    expect(() => attachments.addFromPaths(nodeId, [small, big])).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    );
    expect(nodes.get(nodeId).attachments).toEqual([]);
  });

  it('signale un fichier illisible', () => {
    expect(() =>
      attachments.addFromPaths(nodeId, [
        path.join(workspace().dir, 'absent.txt'),
      ]),
    ).toThrowError(expect.objectContaining({ code: 'IO_ERROR' }));
    expect(() =>
      attachments.addFromPaths(nodeId, [workspace().dir]),
    ).toThrowError(expect.objectContaining({ code: 'IO_ERROR' }));
  });

  it('supprime une pièce jointe', () => {
    const [file] = attachments.addFromPaths(nodeId, [writeFile('a.txt', 'a')]);
    attachments.delete(file!.id);
    expect(nodes.get(nodeId).attachments).toEqual([]);
    expect(() => attachments.get(file!.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('déduit le type MIME de l’extension, sinon octet-stream', () => {
    expect(guessMimeType('Rapport.PDF')).toBe('application/pdf');
    expect(guessMimeType('script.ps1')).toBe('application/octet-stream');
    expect(guessMimeType('sans-extension')).toBe('application/octet-stream');
  });
});

describe('SettingsService', () => {
  it('retourne les valeurs par défaut puis les valeurs enregistrées', () => {
    expect(settings.get()).toEqual({
      attachmentMaxSizeBytes: ATTACHMENT_MAX_SIZE_DEFAULT_BYTES,
    });
    settings.update({ attachmentMaxSizeBytes: 5 * 1024 * 1024 });
    expect(settings.get().attachmentMaxSizeBytes).toBe(5 * 1024 * 1024);
  });

  it('ignore une valeur stockée invalide', () => {
    const ctx = workspace().context();
    ctx.db
      .prepare('INSERT INTO workspace_settings VALUES (?, ?, ?)')
      .run(ctx.workspaceId, 'attachment.maxSizeBytes', 'n’importe quoi');
    expect(settings.get().attachmentMaxSizeBytes).toBe(
      ATTACHMENT_MAX_SIZE_DEFAULT_BYTES,
    );
  });
});
