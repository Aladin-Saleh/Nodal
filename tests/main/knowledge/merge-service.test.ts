import { describe, expect, it } from 'vitest';
import {
  listAnchoredNodes,
  listAnchors,
  saveSnapshot,
  setAnchors,
  withSnapshots,
} from '../../../src/main/knowledge/anchor-service';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { EdgeService } from '../../../src/main/knowledge/edge-service';
import {
  mergeNodes,
  mergePreview,
} from '../../../src/main/knowledge/merge-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { RelationTypeService } from '../../../src/main/knowledge/relation-type-service';
import { SearchService } from '../../../src/main/knowledge/search-service';
import { TagService } from '../../../src/main/knowledge/tag-service';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();
const services = () => {
  const { context } = workspace();
  return {
    context,
    nodes: new NodeService(context),
    documents: new DocumentService(context),
    edges: new EdgeService(context),
  };
};
const node = (
  title: string,
  parentId: string | null = null,
  summary?: string,
) => {
  const { nodes } = services();
  const { id } = nodes.create({ parentId, title, nodeType: 'concept' });
  if (summary) nodes.update({ id, summary });
  return id;
};
const doc = (nodeId: string, title: string, body: string) => {
  const { documents } = services();
  const { id } = documents.create({ nodeId, title, contentType: 'markdown' });
  documents.update({ id, body });
  return id;
};

describe('fusion de nœuds', () => {
  it('réunit documents, sous-nœuds, tags et résumés sans rien écraser', () => {
    const { context, nodes, documents } = services();
    const keep = node('MCP', null, 'Résumé gardé.');
    const drop = node('Serveur MCP', null, 'Autre résumé.');
    const child = node('Enfant', drop);
    doc(keep, 'Un', 'a');
    doc(drop, 'Deux', 'motrare');
    const tag = new TagService(context).create({ name: 'ia' }).id;
    nodes.setTags({ id: drop, tagIds: [tag] });
    expect(mergeNodes(context(), keep, drop)).toMatchObject({ documents: 1 });

    const merged = nodes.get(keep);
    expect(merged.summary).toBe('Résumé gardé.');
    expect(merged.documents.map((item) => item.title)).toEqual([
      'Un',
      'Deux',
      'Résumé de « Serveur MCP »',
    ]);
    expect(documents.get(merged.documents[2]!.id).body).toBe('Autre résumé.\n');
    expect(merged.tags.map((item) => item.name)).toEqual(['ia']);
    expect(nodes.get(child).parentId).toBe(keep);
    expect(() => nodes.get(drop)).toThrow(/introuvable/);
    // L'index de recherche suit le document.
    expect(new SearchService(context).search('motrare')[0]!.nodeId).toBe(keep);
  });

  it('reprend le résumé absent', () => {
    const { context, nodes } = services();
    const keep = node('A');
    const drop = node('B', null, 'Résumé.');
    mergeNodes(context(), keep, drop);
    expect(nodes.get(keep)).toMatchObject({
      summary: 'Résumé.',
      documents: [],
    });
  });

  it('reporte les relations : ni boucle ni double, preuves réunies', () => {
    const { context, edges } = services();
    const [keep, drop, other] = ['A', 'B', 'C'].map((title) => node(title));
    const type = new RelationTypeService(context).list()[0]!.id;
    const create = (sourceId: string, targetId: string, label?: string) =>
      edges.create({ sourceId, targetId, relationTypeId: type, label }).id;
    create(keep!, drop!);
    const kept = create(keep!, other!);
    const twin = create(drop!, other!, 'précis');
    const incoming = create(other!, drop!);
    const { db } = context();
    db.exec(
      `UPDATE edge SET confidence = 'certain' WHERE id = '${twin}';
       INSERT INTO edge_evidence VALUES ('p', '${twin}', 'a.ts', NULL, NULL, NULL, 't');`,
    );
    mergeNodes(context(), keep!, drop!);
    const list = edges.listForNode(keep!);
    expect(list.map((edge) => edge.id).toSorted()).toEqual(
      [kept, incoming].toSorted(),
    );
    expect(list.find((edge) => edge.id === kept)!.label).toBe('précis');
    expect(
      db.prepare('SELECT confidence FROM edge WHERE id = ?').get(kept),
    ).toEqual({ confidence: 'certain' });
    expect(db.prepare('SELECT edge_id FROM edge_evidence').get()).toEqual({
      edge_id: kept,
    });
  });

  it('redirige les liens, par identifiant et par titre', () => {
    const { context, documents, edges } = services();
    const keep = node('Gardé');
    const drop = node('Fondu');
    const reader = node('Lecteur');
    const id = doc(
      reader,
      'Notes',
      `[[Fondu]] [[node:${drop}|ici]] \`[[Fondu]]\``,
    );
    const before = documents.get(id).updatedAt;
    expect(mergeNodes(context(), keep, drop).links).toBe(2);
    expect(documents.get(id)).toMatchObject({
      body: `[[node:${keep}|Fondu]] [[node:${keep}|ici]] \`[[Fondu]]\``,
      updatedAt: before,
    });
    expect(edges.listForNode(reader).map((edge) => edge.otherNodeId)).toEqual([
      keep,
    ]);
  });

  it('fusionne un parent dans son descendant, sans cycle', () => {
    const { context, nodes } = services();
    const root = node('Racine');
    const drop = node('Parent', root);
    const middle = node('Milieu', drop);
    const keep = node('Feuille', middle);
    mergeNodes(context(), keep, drop);
    expect(nodes.get(keep).parentId).toBe(root);
    expect(nodes.get(middle).parentId).toBe(keep);
    // Et un enfant dans son parent.
    mergeNodes(context(), keep, middle);
    expect(nodes.get(keep).parentId).toBe(root);
  });

  it('garde l’état du code : fusionner n’est pas relire', () => {
    const { context } = services();
    const keep = node('A');
    const drop = node('B');
    setAnchors(context(), keep, ['src/a.ts']);
    setAnchors(context(), drop, ['src/b.ts']);
    for (const [id, name] of [
      [keep, 'a'],
      [drop, 'b'],
    ] as const) {
      const [anchored] = listAnchoredNodes(context(), [id]);
      saveSnapshot(context(), id, {
        since: anchored!.since,
        patterns: anchored!.patterns,
        files: { [`app/src/${name}.ts`]: '' },
      });
    }
    doc(drop, 'D', 'x');
    mergeNodes(context(), keep, drop);
    expect(listAnchors(context(), keep)).toEqual(['src/a.ts', 'src/b.ts']);
    const [merged] = withSnapshots(
      context(),
      listAnchoredNodes(context(), [keep]),
    );
    expect(merged!.snapshot).toMatchObject({
      since: merged!.since,
      files: { 'app/src/a.ts': '', 'app/src/b.ts': '' },
    });
  });

  it('propose de garder le plus fourni, refuse un nœud avec lui-même', () => {
    const { context } = services();
    const poor = node('A');
    const rich = node('Un titre plus long');
    doc(rich, 'D', 'x');
    expect(mergePreview(context(), poor, rich).keepId).toBe(rich);
    expect(mergePreview(context(), rich, poor).keepId).toBe(rich);
    // À égalité : le plus ancien.
    const twin = node('Z');
    expect(mergePreview(context(), twin, poor).keepId).toBe(poor);
    expect(() => mergePreview(context(), poor, poor)).toThrow(/lui-même/);
    expect(() => mergeNodes(context(), poor, poor)).toThrow(/lui-même/);
    expect(() => mergeNodes(context(), poor, 'absent')).toThrow(/introuvable/);
  });

  it('annule tout si la fusion échoue', () => {
    const { context, nodes } = services();
    const keep = node('A');
    const drop = node('B');
    const child = node('Enfant', drop);
    const many = (prefix: string) =>
      Array.from({ length: 30 }, (_, i) => `${prefix}/${i}.ts`);
    setAnchors(context(), keep, many('a'));
    setAnchors(context(), drop, many('b'));
    expect(() => mergeNodes(context(), keep, drop)).toThrow(/60 fichiers/);
    expect(nodes.get(child).parentId).toBe(drop);
  });
});
