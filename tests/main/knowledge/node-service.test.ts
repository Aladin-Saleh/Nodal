import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { AttachmentService } from '../../../src/main/knowledge/attachment-service';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { TagService } from '../../../src/main/knowledge/tag-service';
import type { NodeSummary } from '../../../src/shared/model';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();
let nodes: NodeService;
let documents: DocumentService;
let tags: TagService;
let attachments: AttachmentService;

beforeEach(() => {
  const { context } = workspace();
  nodes = new NodeService(context);
  documents = new DocumentService(context);
  tags = new TagService(context);
  attachments = new AttachmentService(context);
});

const create = (title: string, parentId: string | null = null) =>
  nodes.create({ title, parentId, nodeType: 'concept' });

/** Titres des enfants d'un parent, dans l'ordre. */
const childTitles = (parentId: string | null) =>
  nodes
    .list()
    .filter((node) => node.parentId === parentId)
    .toSorted((a, b) => a.sortOrder - b.sortOrder)
    .map((node) => node.title);

function insertEdge(source: NodeSummary, target: NodeSummary) {
  const ctx = workspace().context();
  const relationType = ctx.db
    .prepare('SELECT id FROM relation_type LIMIT 1')
    .get() as { id: string };
  ctx.db
    .prepare(
      `INSERT INTO edge (id, workspace_id, source_node_id, target_node_id, relation_type_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ctx.newId(),
      ctx.workspaceId,
      source.id,
      target.id,
      relationType.id,
      ctx.now(),
      ctx.now(),
    );
}

function attachFile(nodeId: string, name: string, content: string) {
  const filePath = path.join(workspace().dir, name);
  fs.writeFileSync(filePath, content);
  return attachments.addFromPaths(nodeId, [filePath])[0]!;
}

const count = (table: string) =>
  (
    workspace()
      .context()
      .db.prepare(`SELECT count(*) AS n FROM ${table}`)
      .get() as {
      n: number;
    }
  ).n;

describe('création et lecture', () => {
  it('crée des nœuds racines et enfants, ajoutés en fin de liste', () => {
    const a = create('A');
    create('B');
    create('A1', a.id);
    create('A2', a.id);

    expect(childTitles(null)).toEqual(['A', 'B']);
    expect(childTitles(a.id)).toEqual(['A1', 'A2']);
  });

  it('refuse un parent inexistant', () => {
    expect(() => create('X', 'inexistant')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('renvoie la fiche complète avec le chemin hiérarchique', () => {
    const root = create('Racine');
    const mid = create('Milieu', root.id);
    const leaf = create('Feuille', mid.id);
    create('Enfant', leaf.id);
    documents.create({
      nodeId: leaf.id,
      title: 'Doc',
      contentType: 'markdown',
    });

    const detail = nodes.get(leaf.id);
    expect(detail.path.map((item) => item.title)).toEqual(['Racine', 'Milieu']);
    expect(detail.documents.map((doc) => doc.title)).toEqual(['Doc']);
    expect(detail.childCount).toBe(1);
    expect(detail.edgeCount).toBe(0);
    expect(detail.summary).toBeNull();
  });

  it('modifie titre, type, résumé et couleur en conservant l’identifiant', () => {
    const node = create('Avant');
    const updated = nodes.update({
      id: node.id,
      title: 'Après',
      nodeType: 'procedure',
      summary: 'Un résumé',
      color: '#ff0000',
    });
    expect(updated).toMatchObject({
      id: node.id,
      title: 'Après',
      nodeType: 'procedure',
      color: '#ff0000',
    });
    expect(nodes.get(node.id).summary).toBe('Un résumé');

    // Les champs absents ne sont pas modifiés ; null efface.
    nodes.update({ id: node.id, color: null });
    expect(nodes.get(node.id)).toMatchObject({
      title: 'Après',
      color: null,
      summary: 'Un résumé',
    });
  });
});

describe('déplacement', () => {
  it('déplace un nœud sous un autre parent sans toucher à ses relations', () => {
    const a = create('A');
    const b = create('B');
    const child = create('Enfant', a.id);
    insertEdge(child, b);

    nodes.move({ id: child.id, parentId: b.id });

    expect(childTitles(a.id)).toEqual([]);
    expect(childTitles(b.id)).toEqual(['Enfant']);
    expect(nodes.get(child.id).edgeCount).toBe(1);
  });

  it('réordonne les frères selon l’index demandé', () => {
    const a = create('A');
    create('B');
    create('C');
    nodes.move({ id: a.id, parentId: null, index: 2 });
    expect(childTitles(null)).toEqual(['B', 'C', 'A']);
    nodes.move({ id: a.id, parentId: null, index: 0 });
    expect(childTitles(null)).toEqual(['A', 'B', 'C']);
  });

  it('insère à la position demandée chez le nouveau parent', () => {
    const parent = create('Parent');
    create('P1', parent.id);
    create('P2', parent.id);
    const moved = create('Déplacé');
    nodes.move({ id: moved.id, parentId: parent.id, index: 1 });
    expect(childTitles(parent.id)).toEqual(['P1', 'Déplacé', 'P2']);
  });

  it('refuse de déplacer un nœud sous lui-même ou un descendant (cycle)', () => {
    const root = create('Racine');
    const child = create('Enfant', root.id);
    const grandchild = create('Petit-enfant', child.id);

    for (const parentId of [root.id, child.id, grandchild.id]) {
      expect(() => nodes.move({ id: root.id, parentId })).toThrowError(
        expect.objectContaining({ code: 'CONFLICT' }),
      );
    }
    expect(nodes.get(root.id).parentId).toBeNull();
  });

  it('remonte un nœud à la racine', () => {
    const root = create('Racine');
    const child = create('Enfant', root.id);
    nodes.move({ id: child.id, parentId: null });
    expect(childTitles(null)).toEqual(['Racine', 'Enfant']);
  });
});

describe('duplication', () => {
  it('copie documents, tags et pièces jointes, juste après l’original', () => {
    const a = create('A');
    create('B');
    const doc = documents.create({
      nodeId: a.id,
      title: 'Doc',
      contentType: 'code',
      language: 'sql',
    });
    documents.update({ id: doc.id, body: 'SELECT 1;' });
    const tag = tags.create({ name: 'infra' });
    nodes.setTags({ id: a.id, tagIds: [tag.id] });
    attachFile(a.id, 'schema.txt', 'contenu');

    const copy = nodes.duplicate({ id: a.id, includeChildren: false });

    expect(childTitles(null)).toEqual(['A', 'A (copie)', 'B']);
    const detail = nodes.get(copy.id);
    expect(detail.id).not.toBe(a.id);
    expect(detail.tags.map((t) => t.name)).toEqual(['infra']);
    expect(detail.attachments.map((att) => att.fileName)).toEqual([
      'schema.txt',
    ]);
    const copiedDoc = documents.get(detail.documents[0]!.id);
    expect(copiedDoc).toMatchObject({
      title: 'Doc',
      body: 'SELECT 1;',
      language: 'sql',
    });
    expect(copiedDoc.id).not.toBe(doc.id);
    expect(attachments.getData(detail.attachments[0]!.id).data).toEqual(
      new Uint8Array(Buffer.from('contenu')),
    );
  });

  it('ne copie les sous-nœuds que sur demande, et jamais les relations', () => {
    const a = create('A');
    const child = create('Enfant', a.id);
    create('Petit-enfant', child.id);
    insertEdge(a, child);

    const shallow = nodes.duplicate({ id: a.id, includeChildren: false });
    expect(childTitles(shallow.id)).toEqual([]);

    const deep = nodes.duplicate({ id: a.id, includeChildren: true });
    expect(childTitles(deep.id)).toEqual(['Enfant']);
    const childCopy = nodes.list().find((n) => n.parentId === deep.id)!;
    expect(childTitles(childCopy.id)).toEqual(['Petit-enfant']);
    expect(nodes.get(deep.id).edgeCount).toBe(0);
  });
});

describe('suppression', () => {
  it('décrit l’impact pour le nœud seul et pour le sous-arbre', () => {
    const a = create('A');
    const child = create('Enfant', a.id);
    create('Petit-enfant', child.id);
    const other = create('Autre');
    documents.create({ nodeId: a.id, title: 'D1', contentType: 'text' });
    documents.create({ nodeId: child.id, title: 'D2', contentType: 'text' });
    attachFile(child.id, 'f.txt', 'x');
    insertEdge(child, other);

    expect(nodes.getDeletionImpact(a.id)).toEqual({
      childCount: 1,
      descendantCount: 2,
      node: { documentCount: 1, attachmentCount: 0, edgeCount: 0 },
      subtree: { documentCount: 2, attachmentCount: 1, edgeCount: 1 },
    });
  });

  it('stratégie « reparent » : les enfants prennent la place du nœud supprimé', () => {
    create('Avant');
    const a = create('A');
    create('Après');
    create('E1', a.id);
    create('E2', a.id);
    const doc = documents.create({
      nodeId: a.id,
      title: 'Doc',
      contentType: 'text',
    });
    attachFile(a.id, 'f.txt', 'x');

    nodes.delete({ id: a.id, childrenStrategy: 'reparent' });

    expect(childTitles(null)).toEqual(['Avant', 'E1', 'E2', 'Après']);
    expect(() => documents.get(doc.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
    expect(count('attachment')).toBe(0);
  });

  it('stratégie « delete » : supprime tout le sous-arbre et ses relations', () => {
    const a = create('A');
    const child = create('Enfant', a.id);
    const grandchild = create('Petit-enfant', child.id);
    const other = create('Autre');
    documents.create({
      nodeId: grandchild.id,
      title: 'Doc',
      contentType: 'text',
    });
    attachFile(grandchild.id, 'f.txt', 'x');
    insertEdge(other, grandchild);
    const tag = tags.create({ name: 't' });
    nodes.setTags({ id: child.id, tagIds: [tag.id] });

    nodes.delete({ id: a.id, childrenStrategy: 'delete' });

    expect(nodes.list().map((n) => n.title)).toEqual(['Autre']);
    expect(count('document')).toBe(0);
    expect(count('attachment')).toBe(0);
    expect(count('edge')).toBe(0);
    expect(count('node_tag')).toBe(0);
    // Le tag lui-même est conservé.
    expect(tags.list().map((t) => t.name)).toEqual(['t']);
  });

  it('signale un nœud introuvable', () => {
    expect(() =>
      nodes.delete({ id: 'inconnu', childrenStrategy: 'delete' }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('tags d’un nœud', () => {
  it('remplace la liste des tags et ignore les doublons', () => {
    const node = create('N');
    const t1 = tags.create({ name: 'b' });
    const t2 = tags.create({ name: 'a' });
    expect(
      nodes
        .setTags({ id: node.id, tagIds: [t1.id, t2.id, t1.id] })
        .map((t) => t.name),
    ).toEqual(['a', 'b']);
    expect(
      nodes.setTags({ id: node.id, tagIds: [t2.id] }).map((t) => t.name),
    ).toEqual(['a']);
  });

  it('refuse un tag inconnu sans rien modifier', () => {
    const node = create('N');
    const tag = tags.create({ name: 'ok' });
    nodes.setTags({ id: node.id, tagIds: [tag.id] });
    expect(() =>
      nodes.setTags({ id: node.id, tagIds: [tag.id, 'inconnu'] }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(nodes.get(node.id).tags.map((t) => t.name)).toEqual(['ok']);
  });
});
