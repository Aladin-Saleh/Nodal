import fs from 'node:fs';
import path from 'node:path';
import {
  InMemoryTransport,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server';
import { decode as decodeToon } from '@toon-format/toon';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssistantChangeService } from '../../src/main/knowledge/assistant-change-service';
import { DocumentService } from '../../src/main/knowledge/document-service';
import { EdgeService } from '../../src/main/knowledge/edge-service';
import { NodeService } from '../../src/main/knowledge/node-service';
import { RelationTypeService } from '../../src/main/knowledge/relation-type-service';
import { TagService } from '../../src/main/knowledge/tag-service';
import { createNodalMcpServer } from '../../src/mcp/server';
import { listFiles } from '../helpers/temp-dir';
import { testWorkspaceFixture } from '../helpers/test-workspace';

const workspace = testWorkspaceFixture();

interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** Client JSON-RPC minimal relié au serveur en mémoire. */
async function connect(workspaceFile: string, readOnly = true) {
  const server = createNodalMcpServer({
    workspaceFile,
    version: 'test',
    readOnly,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const pending = new Map<number, (message: JSONRPCMessage) => void>();
  // API du transport MCP : un seul gestionnaire, par affectation.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  clientSide.onmessage = (message) => {
    if ('id' in message && typeof message.id === 'number') {
      pending.get(message.id)?.(message);
    }
  };
  await server.connect(serverSide);
  await clientSide.start();
  let nextId = 1;
  const request = (method: string, params: Record<string, unknown>) => {
    const id = nextId++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, (message) => {
        if ('error' in message)
          reject(new Error(JSON.stringify(message.error)));
        else resolve((message as { result: Record<string, unknown> }).result);
      });
      void clientSide.send({ jsonrpc: '2.0', id, method, params });
    });
  };
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  await clientSide.send({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  return {
    init,
    listTools: () => request('tools/list', {}),
    call: async (name: string, args: Record<string, unknown> = {}) =>
      (await request('tools/call', {
        name,
        arguments: args,
      })) as unknown as ToolResult,
    close: () => server.close(),
  };
}

/** Résultat d'un outil décodé depuis TOON. */
const toon = (result: ToolResult) => {
  expect(result.isError).toBeFalsy();
  return decodeToon(result.content[0]!.text) as Record<string, any>;
};

/** Forme abrégée d'un identifiant dans les réponses (8 caractères ici). */
const short = (id: string) => id.slice(0, 8);

/** UUID complet d'un nœud ou document désigné par un identifiant abrégé. */
const full = (prefix: string) =>
  (
    workspace()
      .context()
      .db.prepare(
        'SELECT id FROM node WHERE id LIKE :p UNION ALL SELECT id FROM document WHERE id LIKE :p',
      )
      .get({ p: `${prefix}%` }) as { id: string }
  ).id;

let file: string;
let ids: Record<
  'api' | 'cache' | 'redis' | 'other' | 'notes' | 'query',
  string
>;

beforeEach(() => {
  const { context, service } = workspace();
  file = service.getCurrent()!.filePath;
  const nodes = new NodeService(context);
  const documents = new DocumentService(context);
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
  const redis = nodes.create({
    parentId: cache,
    title: 'Redis',
    nodeType: 'component',
  }).id;
  const other = nodes.create({
    parentId: null,
    title: 'Isolé',
    nodeType: 'generic',
  }).id;
  nodes.update({ id: api, summary: 'Expose les commandes' });
  const notes = documents.create({
    nodeId: api,
    title: 'Notes',
    contentType: 'markdown',
  }).id;
  documents.update({
    id: notes,
    body: '# Déploiement\n\nLe déploiement passe par la CI.\n',
  });
  const query = documents.create({
    nodeId: cache,
    title: 'Requête',
    contentType: 'code',
    language: 'sql',
  }).id;
  documents.update({ id: query, body: 'SELECT 1;\n'.repeat(50) });
  const tag = new TagService(context).create({ name: 'critique' });
  nodes.setTags({ id: api, tagIds: [tag.id] });
  const uses = new RelationTypeService(context).list()[1]!;
  new EdgeService(context).create({
    sourceId: other,
    targetId: redis,
    relationTypeId: uses.id,
    label: 'lit',
  });
  ids = { api, cache, redis, other, notes, query };
});

describe('serveur MCP', () => {
  it('annonce des outils en lecture seule et des instructions', async () => {
    const client = await connect(file);
    expect(client.init.instructions).toContain('TOON');
    const { tools } = (await client.listTools()) as {
      tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
    };
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      'nodal_get_node',
      'nodal_neighborhood',
      'nodal_overview',
      'nodal_read_document',
      'nodal_search',
      'nodal_tree',
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
    await client.close();
  });

  it('donne une vue d’ensemble avec des listes tabulaires TOON', async () => {
    const client = await connect(file);
    const result = await client.call('nodal_overview');
    // Forme tabulaire : en-tête unique, puis une ligne par racine.
    expect(result.content[0]!.text).toMatch(
      /roots\[2\]\{id,title,type,children,descendants,documents\}:/,
    );
    const data = toon(result);
    expect(data.workspace.name).toBe('Espace de test');
    expect(data.stats).toEqual({
      nodes: 4,
      documents: 2,
      relations: 1,
      tags: 1,
      nodesByAssistant: 0,
      relationsByAssistant: 0,
    });
    expect(
      data.roots.map((root: { title: string; descendants: number }) => [
        root.title,
        root.descendants,
      ]),
    ).toEqual([
      ['API', 2],
      ['Isolé', 0],
    ]);
    expect(data.tags).toEqual([{ name: 'critique', usageCount: 1 }]);
    await client.close();
  });

  it('oriente : nœuds les plus reliés et activité récente', async () => {
    const { context } = workspace();
    // Redis devient le nœud le plus relié (2 relations).
    const uses = new RelationTypeService(context).list()[0]!;
    new EdgeService(context).create({
      sourceId: ids.api,
      targetId: ids.redis,
      relationTypeId: uses.id,
    });
    new DocumentService(context).update({ id: ids.query, body: 'SELECT 2;' });
    const client = await connect(file);
    const data = toon(await client.call('nodal_overview'));
    expect(data.hubs[0]).toEqual({
      id: short(ids.redis),
      path: 'API > Cache > Redis',
      relations: 2,
      children: 0,
    });
    expect(data.hubs).toHaveLength(3);
    // Modifier un document compte comme une activité sur son nœud.
    expect(data.recent[0]).toMatchObject({
      id: short(ids.cache),
      path: 'API > Cache',
    });
    expect(data.recent).toHaveLength(4);
    await client.close();
  });

  it('recherche sans accents, avec le chemin et les termes marqués', async () => {
    const client = await connect(file);
    const data = toon(
      await client.call('nodal_search', { query: 'deploiement' }),
    );
    expect(data.nodeCount).toBe(1);
    expect(data.matches[0]).toMatchObject({
      nodeId: short(ids.api),
      path: 'API',
      documentId: short(ids.notes),
      document: 'Notes',
    });
    expect(data.matches[0].snippet).toContain('**Déploiement**');
    await client.close();
  });

  it('détaille un nœud : chemin, documents, enfants et relations', async () => {
    const client = await connect(file);
    const data = toon(await client.call('nodal_get_node', { id: ids.redis }));
    expect(data.node).toMatchObject({
      title: 'Redis',
      path: 'API > Cache > Redis',
      createdBy: 'user',
    });
    expect(data.relations).toEqual([
      {
        direction: 'in',
        relation: expect.any(String),
        otherId: short(ids.other),
        other: 'Isolé',
        label: 'lit',
        by: 'user',
      },
    ]);
    const api = toon(await client.call('nodal_get_node', { id: ids.api }));
    expect(api.node.tags).toBe('critique');
    expect(api.documents.map((doc: { id: string }) => doc.id)).toEqual([
      short(ids.notes),
    ]);
    expect(api.children.map((child: { title: string }) => child.title)).toEqual(
      ['Cache'],
    );
    await client.close();
  });

  it('lit un document brut, par tranches', async () => {
    const client = await connect(file);
    const first = await client.call('nodal_read_document', {
      id: ids.query,
      maxChars: 300,
    });
    const header = toon(first);
    expect(header).toMatchObject({
      totalChars: 500,
      returnedChars: 300,
      nextOffset: 300,
    });
    // Le contenu n'est pas encodé : il arrive tel quel dans un second bloc.
    expect(first.content[1]!.text).toBe('SELECT 1;\n'.repeat(30));
    const rest = await client.call('nodal_read_document', {
      id: ids.query,
      offset: header.nextOffset,
      maxChars: 300,
    });
    expect(toon(rest).nextOffset).toBeNull();
    expect(first.content[1]!.text + rest.content[1]!.text).toBe(
      'SELECT 1;\n'.repeat(50),
    );
    await client.close();
  });

  it('parcourt l’arborescence et le voisinage', async () => {
    const client = await connect(file);
    const shallow = toon(await client.call('nodal_tree', { depth: 0 }));
    expect(shallow.nodes.map((node: { title: string }) => node.title)).toEqual([
      'API',
      'Isolé',
    ]);
    const deep = toon(
      await client.call('nodal_tree', { rootId: ids.api, depth: 5 }),
    );
    expect(
      deep.nodes.map((node: { title: string; depth: number }) => [
        node.title,
        node.depth,
      ]),
    ).toEqual([
      ['API', 0],
      ['Cache', 1],
      ['Redis', 2],
    ]);
    const truncated = toon(
      await client.call('nodal_tree', { depth: 5, maxRows: 2 }),
    );
    expect(truncated).toMatchObject({ truncated: true });

    const around = toon(
      await client.call('nodal_neighborhood', { nodeId: ids.other, depth: 2 }),
    );
    expect(
      Object.fromEntries(
        around.nodes.map((node: { title: string; distance: number }) => [
          node.title,
          node.distance,
        ]),
      ),
    ).toEqual({ Isolé: 0, Redis: 1, Cache: 2 });
    expect(around.relations).toEqual([
      {
        sourceId: short(ids.other),
        relation: expect.any(String),
        targetId: short(ids.redis),
        label: 'lit',
        by: 'user',
      },
    ]);
    await client.close();
  });

  it('abrège les identifiants et accepte préfixe comme UUID complet', async () => {
    const client = await connect(file);
    const tree = await client.call('nodal_tree', { depth: 5 });
    // Texte décodé : TOON met entre guillemets un préfixe qui ressemble à un
    // nombre (« 12345678 », « 1e345678 »), qui reste une chaîne.
    expect(toon(tree).nodes[0]).toMatchObject({
      id: short(ids.api),
      title: 'API',
    });
    expect(tree.content[0]!.text).not.toContain(ids.api);
    // L'ordre des lignes et la profondeur décrivent l'arbre : pas de parentId.
    expect(tree.content[0]!.text).toMatch(
      /nodes\[4\]\{id,title,type,depth,children,documents\}:/,
    );
    for (const id of [short(ids.redis), ids.redis, ids.redis.toUpperCase()]) {
      const data = toon(await client.call('nodal_get_node', { id }));
      expect(data.node.title).toBe('Redis');
    }
    await client.close();
  });

  it('allonge les préfixes qui se ressemblent et refuse un préfixe ambigu', async () => {
    const { context } = workspace();
    const { db, workspaceId, now } = context();
    const insert = db.prepare(
      `INSERT INTO node (id, workspace_id, title, node_type, created_at, updated_at)
       VALUES (?, ?, ?, 'concept', ?, ?)`,
    );
    insert.run(
      'abcdef01-1111-4000-8000-000000000000',
      workspaceId,
      'Jumeau 1',
      now(),
      now(),
    );
    insert.run(
      'abcdef01-2222-4000-8000-000000000000',
      workspaceId,
      'Jumeau 2',
      now(),
      now(),
    );
    const client = await connect(file);
    const data = toon(await client.call('nodal_tree', { depth: 0 }));
    const twins = data.nodes.filter((node: { title: string }) =>
      node.title.startsWith('Jumeau'),
    );
    expect(twins.map((node: { id: string }) => node.id)).toEqual([
      'abcdef01-1',
      'abcdef01-2',
    ]);
    const ambiguous = await client.call('nodal_get_node', { id: 'abcdef01' });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content[0]!.text).toMatch(/ambigu/);
    const exact = toon(
      await client.call('nodal_get_node', { id: 'abcdef01-2' }),
    );
    expect(exact.node.title).toBe('Jumeau 2');
    await client.close();
  });

  it('renvoie une erreur lisible pour un identifiant inconnu', async () => {
    const client = await connect(file);
    const result = await client.call('nodal_get_node', { id: 'inconnu' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Nœud introuvable.');
    await client.close();
  });

  it('voit les modifications faites dans l’application ouverte en parallèle', async () => {
    const { context } = workspace();
    const client = await connect(file);
    expect(
      toon(await client.call('nodal_search', { query: 'kafka' })).nodeCount,
    ).toBe(0);
    new NodeService(context).create({
      parentId: null,
      title: 'Kafka',
      nodeType: 'component',
    });
    expect(
      toon(await client.call('nodal_search', { query: 'kafka' })).nodeCount,
    ).toBe(1);
    await client.close();
  });

  it('lit un espace fermé sans le modifier ni laisser de fichiers annexes', async () => {
    const { service, dir } = workspace();
    service.close();
    const before = fs.readFileSync(file);
    const client = await connect(file);
    expect(toon(await client.call('nodal_overview')).stats.nodes).toBe(4);
    await client.close();
    expect(listFiles(dir)).toEqual([path.basename(file)]);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it('refuse un fichier qui n’est pas un espace Nodal', async () => {
    const { dir } = workspace();
    const bogus = path.join(dir, 'faux.nodal');
    fs.writeFileSync(bogus, 'pas une base');
    const client = await connect(bogus);
    const result = await client.call('nodal_overview');
    expect(result.isError).toBe(true);
    await client.close();
  });
});

const changes = () => new AssistantChangeService(workspace().context).list();

describe('serveur MCP en écriture', () => {
  it('ajoute les outils d’écriture, non marqués en lecture seule', async () => {
    const client = await connect(file, false);
    expect(client.init.instructions).toContain('nodal_search');
    const { tools } = (await client.listTools()) as {
      tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
    };
    const writers = tools.filter((tool) => !tool.annotations?.readOnlyHint);
    expect(writers.map((tool) => tool.name).toSorted()).toEqual([
      'nodal_add_document',
      'nodal_create_node',
      'nodal_link',
      'nodal_tag',
      'nodal_update_document',
      'nodal_update_node',
    ]);
    await client.close();
  });

  it('crée un nœud complet, journalisé et visible par l’application', async () => {
    const client = await connect(file, false);
    const created = toon(
      await client.call('nodal_create_node', {
        title: 'TTL',
        type: 'concept',
        parentId: ids.redis,
        summary: 'Durée de vie des clés.',
        tags: ['Critique', 'perf'],
      }),
    );
    expect(created.path).toBe('API > Cache > Redis > TTL');
    expect(created.id).toHaveLength(8);
    const detail = new NodeService(workspace().context).get(full(created.id));
    expect(detail.summary).toBe('Durée de vie des clés.');
    // « Critique » réutilise le tag existant « critique ».
    expect(detail.tags.map((tag) => tag.name)).toEqual(['critique', 'perf']);
    expect(changes()).toMatchObject([
      {
        action: 'create_node',
        client: 'test',
        nodeId: full(created.id),
        nodeTitle: 'TTL',
        summary: 'Nœud créé : API > Cache > Redis > TTL',
        undoneAt: null,
      },
    ]);
    await client.close();
  });

  it('refuse un doublon au même endroit, sauf demande explicite', async () => {
    const client = await connect(file, false);
    const twin = await client.call('nodal_create_node', {
      title: 'cache',
      type: 'data',
      parentId: ids.api,
    });
    expect(twin.isError).toBe(true);
    expect(twin.content[0]!.text).toContain(ids.cache);
    toon(
      await client.call('nodal_create_node', {
        title: 'cache',
        type: 'data',
        parentId: ids.api,
        allowDuplicate: true,
      }),
    );
    await client.close();
  });

  it('annule une écriture entière si une partie échoue', async () => {
    const client = await connect(file, false);
    const result = await client.call('nodal_create_node', {
      title: 'Partiel',
      type: 'concept',
      tags: ['ok', 'mauvais\u0001'],
    });
    expect(result.isError).toBe(true);
    const nodes = new NodeService(workspace().context).list();
    expect(nodes.some((node) => node.title === 'Partiel')).toBe(false);
    expect(new TagService(workspace().context).list()).toHaveLength(1);
    expect(changes()).toEqual([]);
    await client.close();
  });

  it('signale ses écritures à l’application via data_version', async () => {
    const { service, context } = workspace();
    service.takeExternalChange();
    new NodeService(context).create({
      parentId: null,
      title: 'Local',
      nodeType: 'generic',
    });
    // Nos propres écritures ne comptent pas comme externes.
    expect(service.takeExternalChange()).toBe(false);
    const client = await connect(file, false);
    toon(await client.call('nodal_tag', { nodeId: ids.other, add: ['x'] }));
    expect(service.takeExternalChange()).toBe(true);
    expect(service.takeExternalChange()).toBe(false);
    await client.close();
  });

  it('modifie puis restaure un nœud ; refuse si l’utilisateur l’a retouché', async () => {
    const client = await connect(file, false);
    const updated = toon(
      await client.call('nodal_update_node', {
        id: ids.cache,
        title: 'Cache distribué',
        summary: null,
        parentId: null,
      }),
    );
    expect(updated.changed).toEqual(['title', 'parentId']);
    const service = new AssistantChangeService(workspace().context);
    service.undo(changes()[0]!.id);
    const restored = new NodeService(workspace().context).get(ids.cache);
    expect(restored).toMatchObject({ title: 'Cache', parentId: ids.api });
    expect(changes()[0]!.undoneAt).not.toBeNull();
    expect(() => service.undo(changes()[0]!.id)).toThrow(/déjà annulée/);

    toon(
      await client.call('nodal_update_node', { id: ids.api, summary: 'IA' }),
    );
    new NodeService(workspace().context).update({
      id: ids.api,
      summary: 'Utilisateur',
    });
    expect(() => service.undo(changes()[0]!.id)).toThrow(/modifié depuis/);
    await client.close();
  });

  it('ajoute et complète des documents, annulables', async () => {
    const client = await connect(file, false);
    const added = toon(
      await client.call('nodal_add_document', {
        nodeId: ids.redis,
        title: 'Config',
        contentType: 'code',
        language: 'yaml',
        body: 'maxmemory: 1gb',
      }),
    );
    expect(added.path).toBe('API > Cache > Redis > Config');
    const addedId = full(added.id);
    toon(
      await client.call('nodal_update_document', {
        id: added.id,
        body: 'maxmemory-policy: lru',
      }),
    );
    const documents = new DocumentService(workspace().context);
    expect(documents.get(addedId).body).toBe(
      'maxmemory: 1gb\n\nmaxmemory-policy: lru',
    );
    const service = new AssistantChangeService(workspace().context);
    const [append, create] = changes();
    expect(append!.summary).toBe(
      'Document complété : API > Cache > Redis > Config',
    );
    // Annuler dans l'ordre inverse : l'ajout de texte, puis la création.
    expect(() => service.undo(create!.id)).toThrow(/modifié depuis/);
    service.undo(append!.id);
    expect(documents.get(addedId).body).toBe('maxmemory: 1gb');
    service.undo(create!.id);
    expect(() => documents.get(addedId)).toThrow(/introuvable/);
    await client.close();
  });

  it('relie deux nœuds par le nom de la relation', async () => {
    const client = await connect(file, false);
    const unknown = await client.call('nodal_link', {
      sourceId: ids.api,
      targetId: ids.other,
      relation: 'inspire',
    });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0]!.text).toContain('dépend de');
    const linked = toon(
      await client.call('nodal_link', {
        sourceId: ids.api,
        targetId: ids.other,
        relation: 'DÉPEND DE',
        label: 'au démarrage',
      }),
    );
    expect(linked.relation).toBe('dépend de');
    const edges = new EdgeService(workspace().context);
    expect(edges.listForNode(ids.api)).toHaveLength(1);
    toon(
      await client.call('nodal_link', {
        sourceId: ids.api,
        targetId: ids.redis,
        relation: 'inspire',
        createRelationType: true,
      }),
    );
    new AssistantChangeService(workspace().context).undo(changes()[1]!.id);
    expect(
      edges.listForNode(ids.api).map((edge) => edge.relationTypeName),
    ).toEqual(['inspire']);
    await client.close();
  });

  it('pose et retire des tags, annulables', async () => {
    const client = await connect(file, false);
    const tagged = toon(
      await client.call('nodal_tag', {
        nodeId: ids.api,
        add: ['backend'],
        remove: ['CRITIQUE'],
      }),
    );
    expect(tagged.tags).toBe('backend');
    new AssistantChangeService(workspace().context).undo(changes()[0]!.id);
    expect(
      new NodeService(workspace().context)
        .get(ids.api)
        .tags.map((tag) => tag.name),
    ).toEqual(['critique']);
    await client.close();
  });

  it('ne retire un nœud créé que s’il est resté vide', async () => {
    const client = await connect(file, false);
    const { id } = toon(
      await client.call('nodal_create_node', {
        title: 'Vide',
        type: 'concept',
      }),
    );
    toon(
      await client.call('nodal_create_node', {
        title: 'Enfant',
        type: 'concept',
        parentId: id,
      }),
    );
    const createdId = full(id);
    const service = new AssistantChangeService(workspace().context);
    const [child, parent] = changes();
    expect(() => service.undo(parent!.id)).toThrow(/enfants/);
    service.undo(child!.id);
    service.undo(parent!.id);
    expect(
      new NodeService(workspace().context)
        .list()
        .some((node) => node.id === createdId),
    ).toBe(false);
    await client.close();
  });

  it('marque ce que l’assistant a créé, pour l’application comme pour le LLM', async () => {
    const client = await connect(file, false);
    const created = toon(
      await client.call('nodal_create_node', {
        title: 'Kafka',
        type: 'component',
      }),
    );
    toon(
      await client.call('nodal_link', {
        sourceId: created.id,
        targetId: ids.api,
        relation: 'utilise',
      }),
    );
    const kafka = full(created.id);

    // Application : nœud et relation portent l'assistant et sa date.
    const detail = new NodeService(workspace().context).get(kafka);
    expect(detail.createdByAssistant).toMatchObject({ client: 'test' });
    expect(
      new NodeService(workspace().context).get(ids.api).createdByAssistant,
    ).toBeNull();
    const [byAssistant] = new EdgeService(workspace().context).listForNode(
      kafka,
    );
    expect(byAssistant!.createdByAssistant).toMatchObject({ client: 'test' });
    const [byUser] = new EdgeService(workspace().context).listForNode(
      ids.other,
    );
    expect(byUser!.createdByAssistant).toBeNull();

    // LLM : colonne by / champ createdBy, et compteurs de la vue d'ensemble.
    const node = toon(await client.call('nodal_get_node', { id: created.id }));
    expect(node.node.createdBy).toBe('assistant');
    expect(node.relations[0]).toMatchObject({ by: 'assistant' });
    const around = toon(
      await client.call('nodal_neighborhood', { nodeId: ids.api, depth: 3 }),
    );
    expect(
      around.relations.map((rel: { by: string }) => rel.by).toSorted(),
    ).toEqual(['assistant', 'user']);
    expect(toon(await client.call('nodal_overview')).stats).toMatchObject({
      nodesByAssistant: 1,
      relationsByAssistant: 1,
    });

    // Une relation annulée disparaît, et avec elle sa provenance.
    new AssistantChangeService(workspace().context).undo(changes()[0]!.id);
    expect(toon(await client.call('nodal_overview')).stats).toMatchObject({
      nodesByAssistant: 1,
      relationsByAssistant: 0,
    });
    await client.close();
  });

  it('n’expose aucune écriture en lecture seule', async () => {
    const client = await connect(file);
    await expect(
      client.call('nodal_create_node', { title: 'X', type: 'concept' }),
    ).rejects.toThrow(/not found/);
    await client.close();
  });
});
