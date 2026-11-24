import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AttachmentService } from '../../../src/main/knowledge/attachment-service';
import { compareWithBackup } from '../../../src/main/knowledge/compare-service';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { EdgeService } from '../../../src/main/knowledge/edge-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { RelationTypeService } from '../../../src/main/knowledge/relation-type-service';
import { writeBranchSchema } from '../../../src/main/knowledge/schema-service';
import { TagService } from '../../../src/main/knowledge/tag-service';
import {
  exportVault,
  noteName,
  vaultTag,
} from '../../../src/main/knowledge/vault-export-service';
import { scanMarkdownFolder } from '../../../src/main/markdown-import/markdown-import-service';
import { SCHEMA_MARKER } from '../../../src/shared/mermaid-schema';
import { useTempDir } from '../../helpers/temp-dir';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();
const tempDir = useTempDir();
const node = (title: string, parentId: string | null = null) =>
  new NodeService(workspace().context).create({
    parentId,
    title,
    nodeType: 'component',
  }).id;
const doc = (
  nodeId: string,
  title: string,
  body: string,
  contentType: 'markdown' | 'code' = 'markdown',
) => {
  const documents = new DocumentService(workspace().context);
  const { id } = documents.create({
    nodeId,
    title,
    contentType,
    ...(contentType === 'code' && { language: 'sql' }),
  });
  documents.update({ id, body });
  return id;
};
const relate = (sourceId: string, targetId: string) => {
  const { context } = workspace();
  const type = new RelationTypeService(context).list()[1]!;
  new EdgeService(context).create({
    sourceId,
    targetId,
    relationTypeId: type.id,
  });
  return type.name;
};

describe('schéma gardé comme document', () => {
  it('est remplacé, sauf s’il a été repris par l’utilisateur', () => {
    const { context } = workspace();
    const root = node('Racine');
    const child = node('Enfant', root);
    const documents = new DocumentService(context);
    const first = writeBranchSchema(context(), root).documentId;
    expect(documents.get(first).body).toContain('"Enfant"');
    new NodeService(context).update({ id: child, title: 'Renommé' });
    expect(writeBranchSchema(context(), root).documentId).toBe(first);
    expect(documents.get(first).body).toContain('"Renommé"');
    // Généré : la date de référence du nœud ne bouge pas.
    expect(documents.get(first).updatedAt).toBe(
      new NodeService(context).get(root).updatedAt,
    );
    documents.update({
      id: first,
      body: documents.get(first).body.replace(`${SCHEMA_MARKER}\n`, ''),
    });
    expect(writeBranchSchema(context(), root).documentId).not.toBe(first);
    expect(() => writeBranchSchema(context(), 'absent')).toThrow(/introuvable/);
  });
});

describe('comparaison avec une sauvegarde', () => {
  let count = 0;
  const backup = () => {
    const file = path.join(tempDir(), `avant-${++count}.nodal`);
    workspace()
      .context()
      .db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    return file;
  };

  it('dit ce qui a été ajouté, retiré, modifié, déplacé', () => {
    const { context } = workspace();
    const nodes = new NodeService(context);
    const keep = node('Gardé');
    const gone = node('Parti');
    const moved = node('Déplacé');
    const document = doc(keep, 'Notes', 'abc');
    relate(gone, keep);
    const file = backup();
    expect(compareWithBackup(context(), file)).toMatchObject({
      added: { count: 0 },
      modified: { count: 0 },
      documents: { count: 0 },
    });

    nodes.delete({ id: gone, childrenStrategy: 'reparent' });
    nodes.update({ id: keep, title: 'Gardé bis', summary: 'S' });
    nodes.move({ id: moved, parentId: keep });
    new DocumentService(context).update({ id: document, body: 'abcdef' });
    const added = node('Nouveau', keep);
    const name = relate(added, keep);
    const result = compareWithBackup(context(), file);
    expect(result.added.items).toEqual([
      { nodeId: added, title: 'Nouveau', detail: 'dans « Gardé bis »' },
    ]);
    expect(result.removed.items).toMatchObject([
      { nodeId: null, title: 'Parti' },
    ]);
    expect(result.modified.items).toEqual([
      {
        nodeId: keep,
        title: 'Gardé bis',
        changes: ['titre : « Gardé » → « Gardé bis »', 'résumé'],
      },
      {
        nodeId: moved,
        title: 'Déplacé',
        changes: ['déplacé de la racine à « Gardé bis »'],
      },
    ]);
    expect(result.documents.items).toMatchObject([
      { title: 'Notes', change: 'modified', chars: 3 },
    ]);
    expect(result.relationsAdded.items[0]!.title).toBe(
      `« Nouveau » ${name} « Gardé bis »`,
    );
    expect(result.relationsRemoved.count).toBe(1);
  });

  it('ne modifie pas la sauvegarde, refuse un autre fichier', () => {
    const { context } = workspace();
    const file = backup();
    const before = fs.readFileSync(file);
    compareWithBackup(context(), file);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
    const text = path.join(tempDir(), 'x.nodal');
    fs.writeFileSync(text, 'pas une base');
    expect(() => compareWithBackup(context(), text)).toThrow(/espace Nodal/);
    expect(() => compareWithBackup(context(), `${text}.absent`)).toThrow(
      /introuvable/,
    );
    const { db } = context();
    const copy = backup();
    expect(() =>
      compareWithBackup({ ...context(), db, workspaceId: 'autre' }, copy),
    ).toThrow(/autre espace/);
  });
});

describe('export vers Obsidian', () => {
  it('écrit une note par nœud, relisible par l’import', async () => {
    const { context, dir } = workspace();
    const root = node('Projet : A/B');
    const child = node('Serveur', root);
    const twin = node('serveur');
    new NodeService(context).update({ id: child, summary: 'Dit "oui".' });
    new NodeService(context).setTags({
      id: child,
      tagIds: [new TagService(context).create({ name: 'base de données' }).id],
    });
    doc(child, 'Notes', `Voir [[node:${twin}|l’autre]] et [[Projet : A/B]].`);
    doc(child, 'Requête', 'SELECT 1;\n```\n', 'code');
    const name = relate(child, twin);
    const file = path.join(dir, 'plan.txt');
    fs.writeFileSync(file, 'plan');
    new AttachmentService(context).addFromPaths(child, [file]);

    const result = await exportVault(context(), { name: 'Test' }, tempDir());
    expect(result).toMatchObject({ noteCount: 3, attachmentCount: 1 });
    expect(
      fs
        .readdirSync(result.folderPath, { recursive: true, encoding: 'utf8' })
        .filter((item) => path.extname(item) !== '')
        .map((item) => item.split(path.sep).join('/'))
        .toSorted(),
    ).toEqual([
      'Pièces jointes/plan.txt',
      'Projet _ A_B/Projet _ A_B.md',
      'Projet _ A_B/Serveur.md',
      'serveur (2).md',
    ]);
    const text = fs.readFileSync(
      path.join(result.folderPath, 'Projet _ A_B', 'Serveur.md'),
      'utf8',
    );
    expect(text).toContain('summary: "Dit \\"oui\\"."');
    expect(text).toContain('tags: [base-de-données]');
    expect(text).toContain(
      'Voir [[serveur (2)|l’autre]] et [[Projet _ A_B|Projet : A/B]].',
    );
    expect(text).toContain('````sql\nSELECT 1;\n```\n````');
    expect(text).toContain(`- ${name} [[serveur (2)|serveur]]`);
    expect(text).toContain('[[plan.txt]]');
    expect(scanMarkdownFolder(result.folderPath).notes).toHaveLength(3);
  });

  it('noms et étiquettes sûrs', () => {
    expect(noteName('.env')).toBe('env');
    expect(noteName('A [b] #c.md')).toBe('A b c');
    expect(noteName('???')).not.toBe('');
    expect(noteName('CON')).toBe('_CON');
    expect(noteName('x'.repeat(200))).toHaveLength(60);
    expect(vaultTag('2024')).toBe('n2024');
    expect(vaultTag('C++ !')).toBe('C-');
    expect(vaultTag('!!')).toBe('sans-nom');
  });
});
