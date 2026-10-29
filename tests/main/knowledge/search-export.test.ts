import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AttachmentService } from '../../../src/main/knowledge/attachment-service';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { EdgeService } from '../../../src/main/knowledge/edge-service';
import {
  documentExtension,
  EXPORT_FORMAT_VERSION,
  exportWorkspace,
  safeFileName,
} from '../../../src/main/knowledge/export-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { RelationTypeService } from '../../../src/main/knowledge/relation-type-service';
import {
  SearchService,
  searchTerms,
} from '../../../src/main/knowledge/search-service';
import { TagService } from '../../../src/main/knowledge/tag-service';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();
let nodes: NodeService;
let documents: DocumentService;
let search: SearchService;

beforeEach(() => {
  const { context } = workspace();
  nodes = new NodeService(context);
  documents = new DocumentService(context);
  search = new SearchService(context);
});

const create = (title: string, parentId: string | null = null) =>
  nodes.create({ title, parentId, nodeType: 'component' }).id;

// oxlint-disable-next-line no-control-regex
const strip = (text: string) => text.replace(/[\u0002\u0003]/g, '');

describe('searchTerms', () => {
  it('neutralise la syntaxe FTS (préfixes entre guillemets)', async () => {
    expect(searchTerms('kafka topic kafka')).toEqual(['"kafka"*', '"topic"*']);
    expect(searchTerms('a" OR NEAR(x')).toEqual([
      '"a"*',
      '"OR"*',
      '"NEAR"*',
      '"x"*',
    ]);
    expect(searchTerms('  ;;; ')).toEqual([]);
  });
});

describe('SearchService', () => {
  it('trouve un mot présent uniquement dans un bloc de code (§10.2)', async () => {
    const id = create('Service commandes');
    const doc = documents.create({
      nodeId: id,
      title: 'Requête',
      contentType: 'code',
      language: 'sql',
    });
    documents.update({
      id: doc.id,
      body: "SELECT * FROM orders WHERE status = 'PAID';",
    });

    const [hit] = search.search('orders');
    expect(hit).toMatchObject({ nodeId: id, nodeTitle: 'Service commandes' });
    expect(hit!.matches[0]).toMatchObject({
      kind: 'document',
      documentId: doc.id,
      documentTitle: 'Requête',
    });
    expect(hit!.matches[0]!.snippet).toContain('\u0002orders\u0003');
  });

  it('cherche dans les titres et résumés, sans tenir compte des accents ni de la casse', async () => {
    const id = create('Runbook de déploiement');
    nodes.update({ id, summary: 'Procédure de mise en production' });
    expect(search.search('DEPLOIEMENT').map((hit) => hit.nodeId)).toEqual([id]);
    expect(search.search('product').map((hit) => hit.nodeId)).toEqual([id]);
  });

  it('exige tous les mots, répartis entre le nœud et ses documents', async () => {
    const id = create('Kafka');
    const other = create('Kafka Connect');
    documents.update({
      id: documents.create({
        nodeId: id,
        title: 'Topics',
        contentType: 'markdown',
      }).id,
      body: 'Le topic order-events est partitionné.',
    });
    const hits = search.search('kafka topic');
    expect(hits.map((hit) => hit.nodeId)).toEqual([id]);
    expect(
      search
        .search('kafka')
        .map((hit) => hit.nodeId)
        .toSorted(),
    ).toEqual([id, other].toSorted());
  });

  it('suit les modifications et suppressions (index tenu par triggers)', async () => {
    const id = create('Ancien titre');
    const doc = documents.create({
      nodeId: id,
      title: 'Notes',
      contentType: 'text',
    });
    documents.update({ id: doc.id, body: 'mot-clé initial' });
    expect(search.search('initial')).toHaveLength(1);

    documents.update({ id: doc.id, body: 'contenu remplacé' });
    expect(search.search('initial')).toEqual([]);
    expect(search.search('remplace')).toHaveLength(1);

    nodes.update({ id, title: 'Nouveau titre' });
    expect(search.search('ancien')).toEqual([]);
    expect(strip(search.search('nouveau')[0]!.matches[0]!.snippet)).toBe(
      'Nouveau titre',
    );

    nodes.delete({ id, childrenStrategy: 'delete' });
    expect(search.search('nouveau')).toEqual([]);
    expect(search.search('remplace')).toEqual([]);
  });

  it('indexe les copies créées par duplication', async () => {
    const id = create('Original');
    const doc = documents.create({
      nodeId: id,
      title: 'Doc',
      contentType: 'text',
    });
    documents.update({ id: doc.id, body: 'zanzibar' });
    nodes.duplicate({ id, includeChildren: false });
    expect(search.search('zanzibar')).toHaveLength(2);
  });

  it('retourne une liste vide pour une saisie sans mot', async () => {
    create('Quelque chose');
    expect(search.search('   ')).toEqual([]);
    expect(search.search('"*()')).toEqual([]);
  });
});

describe('exportWorkspace', () => {
  it('écrit un manifest versionné, les documents sources et les pièces jointes', async () => {
    const { context, service, dir } = workspace();
    const ctx = context();
    const parent = create('API');
    const child = create('Cache', parent);
    const md = documents.create({
      nodeId: parent,
      title: 'Notes',
      contentType: 'markdown',
    });
    documents.update({ id: md.id, body: '# Titre\n\nTexte exact  \n' });
    const code = documents.create({
      nodeId: child,
      title: 'Script',
      contentType: 'code',
      language: 'python',
    });
    documents.update({ id: code.id, body: 'print("ok")\n' });
    const tag = new TagService(context).create({ name: 'critique' });
    nodes.setTags({ id: parent, tagIds: [tag.id] });
    const uses = new RelationTypeService(context).list()[1]!.id;
    new EdgeService(context).create({
      sourceId: child,
      targetId: parent,
      relationTypeId: uses,
    });
    const sourceFile = path.join(dir, 'schéma:v1.png');
    const binary = Buffer.from([0, 1, 2, 250, 255]);
    fs.writeFileSync(path.join(dir, 'schema.png'), binary);
    void sourceFile;
    new AttachmentService(context).addFromPaths(parent, [
      path.join(dir, 'schema.png'),
    ]);

    const target = path.join(dir, 'exports');
    fs.mkdirSync(target);
    const result = await exportWorkspace(ctx, service.getCurrent()!, target, {
      name: 'Nodal',
      version: '0.1.0',
    });

    expect(result).toMatchObject({
      nodeCount: 2,
      documentCount: 2,
      attachmentCount: 1,
    });
    expect(fs.readdirSync(target)).toEqual([path.basename(result.folderPath)]);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.folderPath, 'manifest.json'), 'utf8'),
    );
    expect(manifest).toMatchObject({
      format: 'nodal-export',
      formatVersion: EXPORT_FORMAT_VERSION,
      workspace: { name: 'Espace de test' },
    });
    expect(manifest.nodes).toHaveLength(2);
    expect(manifest.edges).toHaveLength(1);
    expect(manifest.tags).toEqual([
      { id: tag.id, name: 'critique', color: null },
    ]);

    const apiNode = manifest.nodes.find((n: { id: string }) => n.id === parent);
    expect(apiNode.tagIds).toEqual([tag.id]);
    const mdEntry = apiNode.documents[0];
    expect(mdEntry.file).toBe(`documents/${md.id}.md`);
    const mdBody = fs.readFileSync(
      path.join(result.folderPath, mdEntry.file),
      'utf8',
    );
    expect(mdBody).toBe('# Titre\n\nTexte exact  \n');
    expect(mdEntry.sha256).toBe(
      createHash('sha256').update(mdBody).digest('hex'),
    );

    const cacheNode = manifest.nodes.find(
      (n: { id: string }) => n.id === child,
    );
    expect(cacheNode.parentId).toBe(parent);
    expect(cacheNode.documents[0].file).toBe(`documents/${code.id}.py`);

    const attachment = apiNode.attachments[0];
    expect(
      fs
        .readFileSync(path.join(result.folderPath, attachment.file))
        .equals(binary),
    ).toBe(true);
    expect(fs.existsSync(path.join(result.folderPath, 'LISEZMOI.txt'))).toBe(
      true,
    );
  });

  it('n’écrase jamais un export existant', async () => {
    const { context, service, dir } = workspace();
    create('A');
    const first = await exportWorkspace(context(), service.getCurrent()!, dir, {
      name: 'Nodal',
      version: '0',
    });
    const second = await exportWorkspace(
      context(),
      service.getCurrent()!,
      dir,
      {
        name: 'Nodal',
        version: '0',
      },
    );
    expect(second.folderPath).not.toBe(first.folderPath);
    expect(fs.existsSync(first.folderPath)).toBe(true);
  });
});

describe('utilitaires d’export', () => {
  it('choisit l’extension selon le type et le langage', async () => {
    expect(documentExtension('markdown', null)).toBe('md');
    expect(documentExtension('mermaid', null)).toBe('mmd');
    expect(documentExtension('code', 'typescript')).toBe('ts');
    expect(documentExtension('code', null)).toBe('txt');
  });

  it('produit des noms de fichiers sûrs sous Windows', async () => {
    expect(safeFileName('a<b>:c"d/e\\f|g?h*', 'x')).toBe('a_b__c_d_e_f_g_h_');
    expect(safeFileName('CON', 'x')).toBe('_CON');
    expect(safeFileName('nom. ', 'x')).toBe('nom');
    expect(safeFileName('   ', 'x')).toBe('x');
  });
});
