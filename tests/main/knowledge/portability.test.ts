import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decode as decodeToon } from '@toon-format/toon';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeNodalDatabase,
  openNodalDatabase,
} from '../../../src/main/database/connection';
import { AttachmentService } from '../../../src/main/knowledge/attachment-service';
import { chunkDocument } from '../../../src/main/knowledge/chunking';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { EdgeService } from '../../../src/main/knowledge/edge-service';
import { exportWorkspace } from '../../../src/main/knowledge/export-service';
import { GraphService } from '../../../src/main/knowledge/graph-service';
import {
  resolveInside,
  validateExportFolder,
} from '../../../src/main/knowledge/import-service';
import {
  buildLlmExport,
  createDefaultTokenizer,
  TIKTOKEN_VERSION,
  writeLlmExport,
  type Tokenizer,
} from '../../../src/main/knowledge/llm-export-service';
import { MaintenanceService } from '../../../src/main/knowledge/maintenance-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { RelationTypeService } from '../../../src/main/knowledge/relation-type-service';
import { SettingsService } from '../../../src/main/knowledge/settings-service';
import { SearchService } from '../../../src/main/knowledge/search-service';
import { TagService } from '../../../src/main/knowledge/tag-service';
import { WorkspaceService } from '../../../src/main/workspace/workspace-service';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

/** Compteur simple pour les tests de découpage : un token par mot. */
const words: Tokenizer = {
  info: {
    name: 'test-words',
    version: '1',
    encoding: 'words',
    targetModel: null,
  },
  count: (text) => text.split(/\s+/).filter(Boolean).length,
};

let nodes: NodeService;
let documents: DocumentService;

beforeEach(() => {
  const { context } = workspace();
  nodes = new NodeService(context);
  documents = new DocumentService(context);
});

/** Espace représentatif : hiérarchie, documents, tag, relation, pièce jointe. */
function seed() {
  const { context, dir } = workspace();
  const api = nodes.create({
    parentId: null,
    title: 'API',
    nodeType: 'component',
  }).id;
  const cache = nodes.create({
    parentId: api,
    title: 'Cache',
    nodeType: 'data',
  }).id;
  const other = nodes.create({
    parentId: null,
    title: 'Isolé',
    nodeType: 'generic',
  }).id;
  nodes.update({ id: api, summary: 'Expose les commandes', color: '#ff0000' });
  const md = documents.create({
    nodeId: api,
    title: 'Notes',
    contentType: 'markdown',
  });
  documents.update({
    id: md.id,
    body: '# Titre\n\nTexte exact  \n\n## Détail\n\nSuite.\n',
  });
  const sql = documents.create({
    nodeId: cache,
    title: 'Requête',
    contentType: 'code',
    language: 'sql',
  });
  documents.update({ id: sql.id, body: 'SELECT 1;\nSELECT 2;\n' });
  const tag = new TagService(context).create({
    name: 'critique',
    color: '#00ff00',
  });
  nodes.setTags({ id: api, tagIds: [tag.id] });
  const uses = new RelationTypeService(context).list()[1]!.id;
  new EdgeService(context).create({
    sourceId: cache,
    targetId: api,
    relationTypeId: uses,
    label: 'lit',
  });
  fs.writeFileSync(path.join(dir, 'schema.bin'), Buffer.from([1, 2, 3, 250]));
  new AttachmentService(context).addFromPaths(api, [
    path.join(dir, 'schema.bin'),
  ]);
  new GraphService(context).savePositions([{ id: api, x: 1, y: 2, z: 3 }]);
  return { api, cache, other, md, sql, tag };
}

function exportTo(name: string) {
  const { context, service, dir } = workspace();
  const target = path.join(dir, name);
  fs.mkdirSync(target);
  return exportWorkspace(context(), service.getCurrent()!, target, {
    name: 'Nodal',
    version: 'test',
  });
}

/** Contenu comparable d'une base, indépendant des rowid. */
function snapshot(db: DatabaseSync) {
  const all = (sql: string) =>
    JSON.parse(JSON.stringify(db.prepare(sql).all()));
  return {
    workspace: all('SELECT * FROM workspace'),
    nodes: all('SELECT * FROM node ORDER BY id'),
    documents: all('SELECT * FROM document ORDER BY id'),
    edges: all('SELECT * FROM edge ORDER BY id'),
    relationTypes: all('SELECT * FROM relation_type ORDER BY id'),
    tags: all('SELECT * FROM tag ORDER BY id'),
    nodeTags: all('SELECT * FROM node_tag ORDER BY node_id, tag_id'),
    attachments: all(
      'SELECT id, node_id, document_id, file_name, mime_type, size_bytes, checksum, created_at, hex(data) AS data FROM attachment ORDER BY id',
    ),
  };
}

describe('sauvegarde et intégrité', () => {
  it('crée une sauvegarde cohérente et réouvrable, sans écraser un fichier', () => {
    seed();
    const { context, dir } = workspace();
    const maintenance = new MaintenanceService(context);
    const target = path.join(dir, 'sauvegarde.nodal');
    maintenance.backupTo(target);

    const db = openNodalDatabase(target);
    try {
      expect(snapshot(db)).toEqual(snapshot(context().db));
    } finally {
      closeNodalDatabase(db);
    }
    expect(() => maintenance.backupTo(target)).toThrowError(
      expect.objectContaining({ code: 'FILE_ALREADY_EXISTS' }),
    );
  });

  it('valide un espace sain et reconstruit un index de recherche incohérent', () => {
    seed();
    const { context } = workspace();
    const maintenance = new MaintenanceService(context);
    expect(maintenance.checkIntegrity()).toMatchObject({ ok: true });

    context().db.exec("DELETE FROM search_index WHERE kind = 'document'");
    expect(new SearchService(context).search('Requête')).toEqual([]);
    const report = maintenance.checkIntegrity();
    expect(report.ok).toBe(true);
    expect(
      report.checks.find((c) => c.name === 'Index de recherche')?.details,
    ).toHaveLength(1);
    expect(new SearchService(context).search('Requête')).toHaveLength(1);
  });
});

describe('import d’un export natif', () => {
  it('reconstruit un espace identique (aller-retour complet)', () => {
    seed();
    const { context, dir } = workspace();
    const exported = exportTo('exports');
    const validation = validateExportFolder(exported.folderPath);
    expect(validation).toMatchObject({ ok: true });
    if (!validation.ok) return;

    const importer = new WorkspaceService();
    try {
      const result = importer.importFrom(
        path.join(dir, 'importé'),
        validation.manifest,
        validation.root,
      );
      expect(result).toMatchObject({
        nodeCount: 3,
        documentCount: 2,
        attachmentCount: 1,
      });
      expect(result.info.filePath).toBe(path.join(dir, 'importé.nodal'));
      expect(snapshot(importer.getDatabase())).toEqual(snapshot(context().db));
      // Réglages : mêmes valeurs effectives (le défaut est écrit explicitement).
      expect(new SettingsService(() => importer.getContext()).get()).toEqual(
        new SettingsService(context).get(),
      );
      // L'index de recherche est alimenté par les triggers.
      expect(
        new SearchService(() => importer.getContext())
          .search('exact')
          .map((hit) => hit.nodeTitle),
      ).toEqual(['API']);
    } finally {
      importer.close();
    }
  });

  it('signale un document modifié, un fichier manquant et un chemin hors du dossier', () => {
    const { md } = seed();
    const exported = exportTo('exports');
    const root = exported.folderPath;
    fs.appendFileSync(path.join(root, `documents/${md.id}.md`), 'altéré');
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const cache = manifest.nodes.find(
      (n: { title: string }) => n.title === 'Cache',
    );
    cache.documents[0].file = '../../evil.sql';
    const api = manifest.nodes.find(
      (n: { title: string }) => n.title === 'API',
    );
    fs.rmSync(path.join(root, api.attachments[0].file));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = validateExportFolder(root);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toMatch(/Notes.*modifié ou corrompu/);
    expect(result.errors.join('\n')).toMatch(
      /Requête.*chemin de fichier refusé/,
    );
    expect(result.errors.join('\n')).toMatch(/schema\.bin.*fichier manquant/);
  });

  it('refuse un dossier qui n’est pas un export, un format plus récent ou un manifest invalide', () => {
    seed();
    const { dir } = workspace();
    expect(validateExportFolder(dir)).toMatchObject({ ok: false });

    const root = exportTo('exports').folderPath;
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, formatVersion: 99 }),
    );
    expect(validateExportFolder(root)).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/plus récent/)],
    });
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, nodes: [{ id: 1 }] }),
    );
    expect(validateExportFolder(root)).toMatchObject({ ok: false });
  });

  it('confine les chemins au dossier d’export', () => {
    const root = path.resolve('/tmp/export');
    expect(resolveInside(root, 'documents/a.md')).toBe(
      path.join(root, 'documents', 'a.md'),
    );
    expect(resolveInside(root, '../a.md')).toBeNull();
    expect(resolveInside(root, path.resolve('/etc/passwd'))).toBeNull();
  });
});

describe('découpage en fragments', () => {
  const count = words.count;

  it('découpe le Markdown par sections en gardant le chemin des titres', () => {
    const body =
      '# Archi\n\nIntro.\n\n## Base\n\nTables et index.\n\n## Cache\n\nRedis.';
    const pieces = chunkDocument(body, 'markdown', null, 50, count);
    expect(pieces.map((piece) => piece.section)).toEqual([
      'Archi',
      'Archi > Base',
      'Archi > Cache',
    ]);
    expect(pieces[1]!.content).toContain('Tables et index.');
  });

  it('garde un bloc de code Markdown entier et répète l’en-tête d’un long tableau', () => {
    const fence = '```sql\nSELECT a\nFROM b\n```';
    expect(
      chunkDocument(`Texte\n\n${fence}`, 'markdown', null, 50, count).some(
        (p) => p.content.includes(fence),
      ),
    ).toBe(true);
    const table = [
      '| a | b |',
      '|---|---|',
      ...Array.from({ length: 6 }, (_, i) => `| ${i} | x |`),
    ].join('\n');
    const pieces = chunkDocument(table, 'markdown', null, 20, count);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces)
      expect(piece.content.startsWith('| a | b |\n|---|---|')).toBe(true);
  });

  it('découpe le SQL par instruction et le JSON par clé', () => {
    const sql = chunkDocument(
      'SELECT 1;\nSELECT 2;\nSELECT 3;',
      'code',
      'sql',
      2,
      count,
    );
    expect(sql.map((piece) => piece.content)).toEqual([
      'SELECT 1;',
      'SELECT 2;',
      'SELECT 3;',
    ]);
    const json = chunkDocument(
      '{"a": 1, "b": {"c": 2}}',
      'json',
      null,
      50,
      count,
    );
    expect(json.map((piece) => piece.section)).toEqual(['$.a', '$.b']);
  });

  it('garde un diagramme Mermaid entier et respecte la taille maximale ailleurs', () => {
    const diagram =
      'graph TD\n' +
      Array.from({ length: 30 }, (_, i) => `A${i} --> B${i}`).join('\n');
    expect(chunkDocument(diagram, 'mermaid', null, 10, count)).toHaveLength(1);
    const text = Array.from(
      { length: 20 },
      (_, i) => `Paragraphe numéro ${i}.`,
    ).join('\n\n');
    for (const piece of chunkDocument(text, 'text', null, 10, count)) {
      expect(count(piece.content)).toBeLessThanOrEqual(10);
    }
  });
});

describe('export LLM', () => {
  it('produit un TOON équivalent au JSON (aller-retour) et des fragments reproductibles', () => {
    seed();
    const { context, service } = workspace();
    const options = { scope: { kind: 'workspace' as const }, maxTokens: 200 };
    const first = buildLlmExport(
      context(),
      service.getCurrent()!,
      options,
      words,
    );
    const second = buildLlmExport(
      context(),
      service.getCurrent()!,
      options,
      words,
    );
    expect(second.chunks.map((c) => c.chunkId)).toEqual(
      first.chunks.map((c) => c.chunkId),
    );

    const { dir } = workspace();
    const result = writeLlmExport(
      context(),
      service.getCurrent()!,
      dir,
      options,
      words,
      {
        name: 'Nodal',
        version: 'test',
      },
    );
    const toon = fs.readFileSync(
      path.join(result.folderPath, 'graph.toon'),
      'utf8',
    );
    const json = JSON.parse(
      fs.readFileSync(path.join(result.folderPath, 'graph.json'), 'utf8'),
    );
    expect(decodeToon(toon)).toEqual(json);
    expect(json.nodes.map((n: { path: string }) => n.path).toSorted()).toEqual([
      'API',
      'API > Cache',
      'Isolé',
    ]);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(result.folderPath, 'manifest.json'), 'utf8'),
    );
    expect(manifest.tokenizer).toEqual(words.info);
    expect(manifest.chunkStrategy).toMatchObject({
      version: 1,
      maxTokens: 200,
    });
    const chunks = fs
      .readFileSync(path.join(result.folderPath, 'chunks.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(chunks.length).toBe(result.chunkCount);
    const sqlChunk = chunks.find((c) => c.language === 'sql');
    expect(sqlChunk).toMatchObject({ hierarchyPath: 'API > Cache > Requête' });
    expect(sqlChunk.relatedNodeIds).toHaveLength(1);
  });

  it('limite l’export à un sous-arbre ou à un voisinage', () => {
    const { api, cache, other } = seed();
    const { context, service } = workspace();
    const ids = (scope: Parameters<typeof buildLlmExport>[2]['scope']) =>
      (
        buildLlmExport(
          context(),
          service.getCurrent()!,
          { scope, maxTokens: 100 },
          words,
        ).graph.nodes as { id: string }[]
      )
        .map((n) => n.id)
        .toSorted();
    expect(ids({ kind: 'subtree', nodeId: cache })).toEqual([cache]);
    expect(ids({ kind: 'subtree', nodeId: api })).toEqual(
      [api, cache].toSorted(),
    );
    expect(ids({ kind: 'neighborhood', nodeId: other, depth: 3 })).toEqual([
      other,
    ]);
  });

  it('compte les tokens avec un tokenizer identifié (o200k_base)', async () => {
    const tokenizer = await createDefaultTokenizer();
    expect(tokenizer.info).toMatchObject({
      name: 'js-tiktoken',
      encoding: 'o200k_base',
    });
    expect(tokenizer.count('hello world')).toBe(2);
    const installed = JSON.parse(
      fs.readFileSync(
        path.resolve('node_modules/js-tiktoken/package.json'),
        'utf8',
      ),
    ).version;
    expect(TIKTOKEN_VERSION).toBe(installed);
  });
});
