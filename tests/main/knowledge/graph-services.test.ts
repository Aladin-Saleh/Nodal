import { beforeEach, describe, expect, it } from 'vitest';
import { EdgeService } from '../../../src/main/knowledge/edge-service';
import { GraphService } from '../../../src/main/knowledge/graph-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { RelationTypeService } from '../../../src/main/knowledge/relation-type-service';
import { TagService } from '../../../src/main/knowledge/tag-service';
import { DEFAULT_RELATION_TYPES } from '../../../src/shared/domain';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();
let nodes: NodeService;
let edges: EdgeService;
let relationTypes: RelationTypeService;
let graph: GraphService;
let tags: TagService;
let a: string;
let b: string;
let c: string;
let uses: string;

beforeEach(() => {
  const { context } = workspace();
  nodes = new NodeService(context);
  edges = new EdgeService(context);
  relationTypes = new RelationTypeService(context);
  graph = new GraphService(context);
  tags = new TagService(context);
  const create = (title: string, parentId: string | null = null) =>
    nodes.create({ parentId, title, nodeType: 'component' }).id;
  a = create('API');
  b = create('Base');
  c = create('Cache', a);
  uses = relationTypes.list().find((type) => type.name === 'utilise')!.id;
});

describe('RelationTypeService', () => {
  it('liste les types par défaut, marqués comme intégrés', () => {
    const list = relationTypes.list();
    expect(list.map((type) => type.name)).toEqual([...DEFAULT_RELATION_TYPES]);
    expect(list.every((type) => type.isBuiltin && type.usageCount === 0)).toBe(
      true,
    );
  });

  it('ajoute, renomme (même intégré) et colore un type', () => {
    const created = relationTypes.create({ name: 'appelle', color: '#123456' });
    expect(created).toMatchObject({
      name: 'appelle',
      color: '#123456',
      isBuiltin: false,
    });
    expect(relationTypes.update({ id: uses, name: 'emploie' }).name).toBe(
      'emploie',
    );
  });

  it('refuse un nom en double, sans tenir compte de la casse', () => {
    expect(() => relationTypes.create({ name: 'UTILISE' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
  });

  it('refuse de supprimer un type utilisé, accepte sinon', () => {
    edges.create({ sourceId: a, targetId: b, relationTypeId: uses });
    expect(() => relationTypes.delete(uses)).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    const unused = relationTypes.create({ name: 'temporaire' });
    relationTypes.delete(unused.id);
    expect(relationTypes.list().map((type) => type.name)).not.toContain(
      'temporaire',
    );
  });
});

describe('EdgeService', () => {
  it('crée une relation et la liste depuis chaque extrémité', () => {
    const edge = edges.create({
      sourceId: a,
      targetId: b,
      relationTypeId: uses,
      label: 'lit',
    });
    expect(edge).toMatchObject({ sourceId: a, targetId: b, label: 'lit' });

    expect(edges.listForNode(a)).toEqual([
      expect.objectContaining({
        id: edge.id,
        direction: 'outgoing',
        otherNodeId: b,
        otherNodeTitle: 'Base',
        relationTypeName: 'utilise',
      }),
    ]);
    expect(edges.listForNode(b)).toEqual([
      expect.objectContaining({
        direction: 'incoming',
        otherNodeId: a,
        otherNodeTitle: 'API',
      }),
    ]);
    expect(
      relationTypes.list().find((type) => type.id === uses)?.usageCount,
    ).toBe(1);
  });

  it('relie des nœuds indépendamment de la hiérarchie', () => {
    edges.create({ sourceId: c, targetId: b, relationTypeId: uses });
    expect(nodes.get(c).parentId).toBe(a);
    expect(nodes.get(c).edgeCount).toBe(1);
  });

  it('refuse une boucle, un doublon et des références inconnues', () => {
    expect(() =>
      edges.create({ sourceId: a, targetId: a, relationTypeId: uses }),
    ).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    edges.create({ sourceId: a, targetId: b, relationTypeId: uses });
    expect(() =>
      edges.create({ sourceId: a, targetId: b, relationTypeId: uses }),
    ).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() =>
      edges.create({ sourceId: a, targetId: 'inconnu', relationTypeId: uses }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() =>
      edges.create({ sourceId: a, targetId: c, relationTypeId: 'inconnu' }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('modifie le type et le libellé, puis supprime sans toucher aux nœuds', () => {
    const edge = edges.create({
      sourceId: a,
      targetId: b,
      relationTypeId: uses,
      label: 'x',
    });
    const dependsOn = relationTypes
      .list()
      .find((type) => type.name === 'dépend de')!.id;
    const updated = edges.update({
      id: edge.id,
      relationTypeId: dependsOn,
      label: null,
    });
    expect(updated).toMatchObject({ relationTypeId: dependsOn, label: null });

    edges.delete(edge.id);
    expect(edges.listForNode(a)).toEqual([]);
    expect(nodes.list()).toHaveLength(3);
  });

  it('refuse qu’une modification crée un doublon', () => {
    const dependsOn = relationTypes
      .list()
      .find((type) => type.name === 'dépend de')!.id;
    edges.create({ sourceId: a, targetId: b, relationTypeId: uses });
    const other = edges.create({
      sourceId: a,
      targetId: b,
      relationTypeId: dependsOn,
    });
    expect(() =>
      edges.update({ id: other.id, relationTypeId: uses }),
    ).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });
});

describe('GraphService', () => {
  it('retourne nœuds, relations, types et tags, sans contenu documentaire', () => {
    const tag = tags.create({ name: 'critique' });
    nodes.setTags({ id: b, tagIds: [tag.id] });
    const edge = edges.create({
      sourceId: a,
      targetId: b,
      relationTypeId: uses,
    });

    const data = graph.get();
    expect(data.nodes.map((node) => node.title).toSorted()).toEqual([
      'API',
      'Base',
      'Cache',
    ]);
    expect(data.nodes.find((node) => node.id === b)).toMatchObject({
      tagIds: [tag.id],
      x: null,
      y: null,
    });
    expect(data.nodes.find((node) => node.id === c)?.parentId).toBe(a);
    expect(data.edges.map((e) => e.id)).toEqual([edge.id]);
    expect(data.relationTypes).toHaveLength(DEFAULT_RELATION_TYPES.length);
  });

  it('enregistre les positions et ignore les nœuds inconnus', () => {
    graph.savePositions([
      { id: a, x: 10, y: -20.5, z: 3 },
      { id: 'inconnu', x: 1, y: 1, z: 1 },
    ]);
    expect(graph.get().nodes.find((node) => node.id === a)).toMatchObject({
      x: 10,
      y: -20.5,
      z: 3,
    });
  });

  it('supprime les relations d’un nœud supprimé', () => {
    edges.create({ sourceId: c, targetId: b, relationTypeId: uses });
    nodes.delete({ id: a, childrenStrategy: 'delete' });
    expect(graph.get().edges).toEqual([]);
  });
});
