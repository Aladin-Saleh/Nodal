import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AttachmentService } from '../../../src/main/knowledge/attachment-service';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { EdgeService } from '../../../src/main/knowledge/edge-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import {
  backupPathBeforeImport,
  previewMarkdownImport,
  scanMarkdownFolder,
  writeMarkdownImport,
} from '../../../src/main/markdown-import/markdown-import-service';
import {
  createVaultResolver,
  findVaultLinks,
  readFrontMatter,
} from '../../../src/main/markdown-import/vault';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

describe('front-matter', () => {
  it('lit titre, type, résumé, tags et alias sans rien interpréter', () => {
    const { meta, body } = readFrontMatter(
      [
        '---',
        'title: "Cache Redis"',
        'type: composant',
        'description: >',
        '  Garde les sessions',
        '  en mémoire.',
        'tags: [infra, "#perf"]',
        'aliases:',
        '  - redis',
        '  - cache',
        'autre: !!js/function "alert(1)"',
        '---',
        '# Corps',
      ].join('\n'),
    );
    expect(meta).toEqual({
      title: 'Cache Redis',
      summary: 'Garde les sessions en mémoire.',
      nodeType: 'component',
      tags: ['infra', 'perf'],
      aliases: ['redis', 'cache'],
    });
    expect(body).toBe('# Corps');
  });

  it('laisse un texte sans front-matter tel quel', () => {
    expect(readFrontMatter('# Titre\n---\n')).toEqual({
      meta: null,
      body: '# Titre\n---\n',
    });
  });
});

describe('liens Obsidian', () => {
  it('relève wiki, alias, titres, intégrations et liens Markdown, hors code', () => {
    const links = findVaultLinks(
      '[[A]] [[b/B#Sec|vu]] ![[img.png]] [doc](C%20d.md) `[[code]]` [web](https://x.y)',
    );
    expect(
      links.map(({ target, heading, alias, embed, style }) => ({
        target,
        heading,
        alias,
        embed,
        style,
      })),
    ).toEqual([
      { target: 'A', heading: null, alias: null, embed: false, style: 'wiki' },
      {
        target: 'b/B',
        heading: 'Sec',
        alias: 'vu',
        embed: false,
        style: 'wiki',
      },
      {
        target: 'img.png',
        heading: null,
        alias: null,
        embed: true,
        style: 'wiki',
      },
      {
        target: 'C d.md',
        heading: null,
        alias: 'doc',
        embed: false,
        style: 'markdown',
      },
    ]);
  });

  it('résout comme Obsidian : relatif, depuis la racine, par nom le plus proche, par alias', () => {
    const notes = [
      { path: 'a/Note.md', title: 'Note', aliases: [] },
      { path: 'b/Note.md', title: 'Note', aliases: [] },
      { path: 'Autre.md', title: 'Autre', aliases: ['alias'] },
    ];
    const resolver = createVaultResolver(notes, ['assets/img.png']);
    expect(resolver.note('Note', 'b/x.md')?.path).toBe('b/Note.md');
    expect(resolver.note('a/Note', 'b/x.md')?.path).toBe('a/Note.md');
    expect(resolver.note('../Autre.md', 'a/Note.md')?.path).toBe('Autre.md');
    expect(resolver.note('ALIAS', 'a/Note.md')?.path).toBe('Autre.md');
    expect(resolver.note('../../hors', 'a/Note.md')).toBeNull();
    expect(resolver.file('img.png', 'a/Note.md')).toBe('assets/img.png');
  });
});

function vault(dir: string, files: Record<string, string>) {
  const root = path.join(dir, 'Coffre');
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

describe('import d’un dossier Markdown', () => {
  it('crée la hiérarchie, les documents, les liens, les tags et les pièces jointes', () => {
    const { context, dir, service } = workspace();
    const existing = new NodeService(context).create({
      parentId: null,
      title: 'Kafka',
      nodeType: 'component',
    });
    const root = vault(dir, {
      'Infra/Redis.md':
        '---\ntype: component\ntags: [infra]\nsummary: Cache\n---\nVoir [[API|l’API]] et [[Kafka]] ![[schema.png]]',
      'API.md': 'Utilise [[Infra/Redis#Config]] et [[Absente]].',
      'assets/schema.png': 'PNG',
      'assets/inutile.png': 'PNG',
      '.obsidian/app.json': '{}',
      'Vide/rien.txt': 'x',
    });

    const scan = scanMarkdownFolder(root);
    const preview = previewMarkdownImport(scan, context(), 't');
    expect(preview).toMatchObject({
      folderName: 'Coffre',
      folderCount: 1,
      noteCount: 2,
      attachmentCount: 1,
      linkCount: 3,
      unresolvedCount: 1,
      unresolved: [{ note: 'API.md', target: 'Absente' }],
      frontMatterCount: 1,
    });

    const backup = backupPathBeforeImport(
      service.getCurrent()!.filePath,
      new Date(),
    );
    const report = writeMarkdownImport(scan, context(), backup);
    expect(report).toMatchObject({
      nodeCount: 4,
      documentCount: 2,
      attachmentCount: 1,
      relationCount: 3,
    });

    const nodes = new NodeService(context);
    const all = nodes.list();
    const byTitle = (title: string) => all.find((n) => n.title === title)!;
    const redis = nodes.get(byTitle('Redis').id);
    expect(redis.path.map((step) => step.title)).toEqual(['Coffre', 'Infra']);
    expect(redis).toMatchObject({ nodeType: 'component', summary: 'Cache' });
    expect(redis.tags.map((tag) => tag.name)).toEqual(['infra']);
    const body = new DocumentService(context).get(redis.documents[0]!.id).body;
    expect(body).toBe(
      `Voir [[node:${byTitle('API').id}|l’API]] et [[node:${existing.id}]] *Pièce jointe : schema.png*`,
    );
    expect(
      new AttachmentService(context).getData(redis.attachments[0]!.id).fileName,
    ).toBe('schema.png');
    const apiBody = new DocumentService(context).get(
      nodes.get(byTitle('API').id).documents[0]!.id,
    ).body;
    expect(apiBody).toBe(
      `Utilise [[node:${redis.id}|Redis › Config]] et [[Absente]].`,
    );
    expect(new EdgeService(context).listForNode(redis.id)).toHaveLength(3);
  });

  it('ignore les liens symboliques et signale une note non UTF-8', () => {
    const { dir } = workspace();
    const root = vault(dir, { 'A.md': 'ok' });
    fs.writeFileSync(path.join(root, 'B.md'), Buffer.from([0xff, 0xfe, 0x00]));
    let linked = true;
    try {
      fs.symlinkSync(path.join(root, 'A.md'), path.join(root, 'Lien.md'));
    } catch {
      linked = false; // Windows sans droit de créer des liens symboliques.
    }
    const scan = scanMarkdownFolder(root);
    expect(scan.notes.map((note) => note.path)).toEqual(['A.md']);
    expect(scan.skipped).toEqual(
      expect.arrayContaining([
        { path: 'B.md', reason: 'encodage non UTF-8' },
        ...(linked
          ? [{ path: 'Lien.md', reason: 'lien symbolique ignoré' }]
          : []),
      ]),
    );
  });
});
