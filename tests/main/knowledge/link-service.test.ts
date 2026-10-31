import { describe, expect, it } from 'vitest';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { EdgeService } from '../../../src/main/knowledge/edge-service';
import { listBacklinks } from '../../../src/main/knowledge/link-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { RelationTypeService } from '../../../src/main/knowledge/relation-type-service';
import { formatNodeLink } from '../../../src/shared/wiki-links';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

function setup() {
  const { context } = workspace();
  const nodes = new NodeService(context);
  const documents = new DocumentService(context);
  const edges = new EdgeService(context);
  const node = (title: string) =>
    nodes.create({ parentId: null, title, nodeType: 'concept' }).id;
  const api = node('API');
  const cache = node('Cache');
  const kafka = node('Kafka');
  const doc = documents.create({
    nodeId: api,
    title: 'Notes',
    contentType: 'markdown',
  }).id;
  const write = (body: string) => documents.update({ id: doc, body });
  const linkEdges = () =>
    edges
      .listForNode(api)
      .filter((edge) => edge.direction === 'outgoing')
      .map((edge) => ({
        to: edge.otherNodeTitle,
        type: edge.relationTypeName,
        fromLink: edge.fromLink ?? false,
      }));
  return {
    context,
    nodes,
    documents,
    edges,
    api,
    cache,
    kafka,
    doc,
    write,
    linkEdges,
  };
}

describe('relations issues des liens [[...]]', () => {
  it('suivent le texte : ajout, retrait, par identifiant ou par titre', () => {
    const { write, linkEdges, cache } = setup();
    write(`Le ${formatNodeLink(cache, 'cache')} et [[kafka]].`);
    expect(linkEdges()).toEqual([
      { to: 'Cache', type: 'est lié à', fromLink: true },
      { to: 'Kafka', type: 'est lié à', fromLink: true },
    ]);
    write('Plus que [[Kafka]].');
    expect(linkEdges().map((edge) => edge.to)).toEqual(['Kafka']);
    write('Plus rien.');
    expect(linkEdges()).toEqual([]);
  });

  it('ne touchent jamais une relation créée à la main', () => {
    const { write, linkEdges, edges, api, cache, kafka, context } = setup();
    const linkType = new RelationTypeService(context)
      .list()
      .find((type) => type.name === 'est lié à')!;
    edges.create({
      sourceId: api,
      targetId: cache,
      relationTypeId: linkType.id,
    });
    write(`[[node:${cache}]] [[Kafka]]`);
    write('');
    // La relation manuelle reste, celle du lien vers Kafka est partie.
    expect(linkEdges()).toEqual([
      { to: 'Cache', type: 'est lié à', fromLink: false },
    ]);
    // Retouchée à la main, une relation issue d'un lien ne suit plus le lien.
    write('[[Kafka]]');
    const fromLink = edges.listForNode(kafka)[0]!;
    edges.update({ id: fromLink.id, label: 'publie' });
    write('');
    expect(
      linkEdges()
        .map((edge) => edge.to)
        .toSorted(),
    ).toEqual(['Cache', 'Kafka']);
  });

  it('ignorent un lien vers soi-même ou cassé, et suivent la suppression du document', () => {
    const { write, linkEdges, documents, doc } = setup();
    write('[[API]] [[Inexistant]] [[Cache]]');
    expect(linkEdges().map((edge) => edge.to)).toEqual(['Cache']);
    documents.delete(doc);
    expect(linkEdges()).toEqual([]);
  });

  it('recréent le type « est lié à » s’il a disparu', () => {
    const { write, linkEdges, context } = setup();
    const types = new RelationTypeService(context);
    types.delete(types.list().find((type) => type.name === 'est lié à')!.id);
    write('[[Cache]]');
    expect(linkEdges()).toEqual([
      { to: 'Cache', type: 'est lié à', fromLink: true },
    ]);
  });

  it('sont recréées pour une copie du nœud', () => {
    const { write, nodes, api, edges } = setup();
    write('[[Cache]]');
    const copy = nodes.duplicate({ id: api, includeChildren: false });
    expect(
      edges
        .listForNode(copy.id)
        .map((edge) => [edge.otherNodeTitle, edge.fromLink]),
    ).toEqual([['Cache', true]]);
  });
});

describe('rétroliens « Mentionné dans »', () => {
  it('listent les documents qui mentionnent le nœud, avec un extrait lisible', () => {
    const { write, context, cache, kafka } = setup();
    write(
      `Le service lit le ${formatNodeLink(cache)} puis publie dans [[Kafka|le bus]].`,
    );
    const [mention] = listBacklinks(context(), cache);
    expect(mention).toMatchObject({ nodeTitle: 'API', documentTitle: 'Notes' });
    expect(mention!.snippet).toBe(
      'Le service lit le [[Cache]] puis publie dans [[le bus]].',
    );
    expect(listBacklinks(context(), kafka)).toHaveLength(1);
    // Un titre cité sans lien n'est pas un rétrolien.
    expect(listBacklinks(context(), cache)).toHaveLength(1);
  });

  it('suivent le renommage pour un lien par identifiant', () => {
    const { write, context, cache, nodes } = setup();
    write(formatNodeLink(cache));
    nodes.update({ id: cache, title: 'Cache distribué' });
    expect(listBacklinks(context(), cache)[0]!.snippet).toBe(
      '[[Cache distribué]]',
    );
  });
});
