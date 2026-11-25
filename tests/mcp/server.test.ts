import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decode as decodeToon } from '@toon-format/toon';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  listAnchors,
  readCodeRoots,
  setAnchors,
  writeCodeRoots,
} from '../../src/main/knowledge/anchor-service';
import { NODAL_APPLICATION_ID } from '../../src/main/database/connection';
import {
  getSchemaVersion,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
} from '../../src/main/database/migrations';
import { AssistantChangeService } from '../../src/main/knowledge/assistant-change-service';
import { DocumentService } from '../../src/main/knowledge/document-service';
import { EdgeService } from '../../src/main/knowledge/edge-service';
import { GraphService } from '../../src/main/knowledge/graph-service';
import { NodeService } from '../../src/main/knowledge/node-service';
import { RelationTypeService } from '../../src/main/knowledge/relation-type-service';
import { TagService } from '../../src/main/knowledge/tag-service';
import { connect, type ToolResult } from '../helpers/mcp-client';
import { listFiles } from '../helpers/temp-dir';
import { contextHookOutput } from '../../src/mcp/context-hook';
import { readLogFile } from '../../src/mcp/read-proof';
import { testWorkspaceFixture } from '../helpers/test-workspace';

const workspace = testWorkspaceFixture();

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

describe('liens [[...]] et MCP', () => {
  it('sert les liens lisibles, indique les rétroliens et reconvertit à l’écriture', async () => {
    const { context } = workspace();
    new DocumentService(context).update({
      id: ids.notes,
      body: `Le [[node:${ids.cache}|cache]] lit [[Redis]] ; [[Fantôme]].`,
    });
    const client = await connect(file, false);
    const read = await client.call('nodal_read_document', { id: ids.notes });
    // Contenu brut après la ligne TOON d'en-tête.
    const served = read.content[1]!.text;
    expect(served).toBe(
      `Le [[Cache|cache]](${short(ids.cache)}) lit [[Redis]](${short(ids.redis)}) ; [[Fantôme (lien cassé)]].`,
    );
    // Rétroliens compacts dans le détail du nœud visé ; absents sinon.
    const cache = toon(await client.call('nodal_get_node', { id: ids.cache }));
    expect(cache.mentionedIn).toEqual([
      { id: short(ids.api), title: 'API', document: 'Notes' },
    ]);
    expect(
      toon(await client.call('nodal_get_node', { id: ids.other })).mentionedIn,
    ).toBeUndefined();

    // Réécriture du texte servi : les liens redeviennent des liens par id.
    toon(
      await client.call('nodal_update_document', {
        id: ids.notes,
        body: served,
        mode: 'replace',
      }),
    );
    expect(new DocumentService(context).get(ids.notes).body).toBe(
      `Le [[node:${ids.cache}|cache]] lit [[node:${ids.redis}]] ; [[Fantôme (lien cassé)]].`,
    );
    // Les relations « est lié à » suivent les liens, écrites par l'assistant.
    const linked = new EdgeService(context)
      .listForNode(ids.api)
      .filter((edge) => edge.fromLink)
      .map((edge) => edge.otherNodeTitle)
      .toSorted();
    expect(linked).toEqual(['Cache', 'Redis']);
    await client.close();
  });
});

const gaps = () =>
  workspace().context().db.prepare('SELECT query, count FROM search_gap').all();

describe('nodal_health et sujets à documenter', () => {
  it('note une recherche sans résultat, pas en lecture seule', async () => {
    const readOnly = await connect(file);
    toon(await readOnly.call('nodal_search', { query: 'zzzintrouvable' }));
    await readOnly.close();
    expect(gaps()).toEqual([]);

    const client = await connect(file, false);
    toon(await client.call('nodal_search', { query: 'zzzintrouvable' }));
    toon(await client.call('nodal_search', { query: 'ZZZintrouvable' }));
    // Une recherche fructueuse n'est pas notée.
    toon(await client.call('nodal_search', { query: 'déploiement' }));
    expect(gaps()).toEqual([{ query: 'ZZZintrouvable', count: 2 }]);

    const result = await client.call('nodal_health', { limit: 2 });
    const report = toon(result);
    expect(report.counts).toMatchObject({ noSummary: 3, brokenLink: 0 });
    expect(report.issues).toHaveLength(
      Object.values(report.counts as Record<string, number>).reduce(
        (sum, count) => sum + Math.min(count, 2),
        0,
      ),
    );
    expect(report.issues[0]).toMatchObject({ check: 'noSummary' });
    expect(report.gaps).toEqual([
      { query: 'ZZZintrouvable', count: 2, lastAt: expect.any(String) },
    ]);
    // Mesure (docs/benchmark-tokens-mcp.md) : réponse compacte.
    expect(result.content[0]!.text.length).toBeLessThan(900);
    await client.close();
  });
});

describe('nodal_path', () => {
  it('trouve le plus court chemin, hiérarchie comprise si demandé', async () => {
    const client = await connect(file);
    const without = toon(
      await client.call('nodal_path', { fromId: ids.other, toId: ids.api }),
    );
    expect(without).toMatchObject({ found: false, to: 'API' });
    expect(without.note).toContain('includeHierarchy');

    const result = await client.call('nodal_path', {
      fromId: short(ids.other),
      toId: ids.api,
      includeHierarchy: true,
    });
    const found = toon(result);
    expect(found).toMatchObject({ from: 'Isolé', to: 'API', length: 3 });
    const uses = new RelationTypeService(workspace().context).list()[1]!.name;
    expect(found.steps).toEqual([
      { id: short(ids.other), title: 'Isolé', via: '' },
      { id: short(ids.redis), title: 'Redis', via: `→ ${uses}` },
      { id: short(ids.cache), title: 'Cache', via: '↑ parent' },
      { id: short(ids.api), title: 'API', via: '↑ parent' },
    ]);
    // Sens inverse : relation remontée, hiérarchie descendue.
    const back = toon(
      await client.call('nodal_path', {
        fromId: ids.api,
        toId: ids.other,
        includeHierarchy: true,
      }),
    );
    expect(back.steps.map((step: { via: string }) => step.via)).toEqual([
      '',
      '↓ enfant',
      '↓ enfant',
      `← ${uses}`,
    ]);
    // Trop loin pour maxDepth.
    expect(
      toon(
        await client.call('nodal_path', {
          fromId: ids.api,
          toId: ids.other,
          includeHierarchy: true,
          maxDepth: 2,
        }),
      ),
    ).toMatchObject({ found: false });
    // Mesure (docs/benchmark-tokens-mcp.md) : réponse compacte.
    expect(result.content[0]!.text.length).toBeLessThan(300);
    await client.close();
  });

  it('dit s’il existe un chemin plus long, ou en sens inverse', async () => {
    const client = await connect(file);
    const find = async (extra: object) =>
      toon(
        await client.call('nodal_path', {
          fromId: ids.other,
          toId: ids.api,
          includeHierarchy: true,
          ...extra,
        }),
      );
    expect((await find({ maxDepth: 1 })).note).toContain('en 3 liens');
    const same = await client.call('nodal_path', {
      fromId: ids.api,
      toId: ids.api,
    });
    expect(same.isError).toBe(true);
    const reverse = toon(
      await client.call('nodal_path', {
        fromId: ids.redis,
        toId: ids.other,
        directed: true,
      }),
    );
    expect(reverse.note).toContain('sans tenir compte du sens');
    await client.close();
  });

  it('signale un nœud inconnu', async () => {
    const client = await connect(file);
    const result = await client.call('nodal_path', {
      fromId: ids.api,
      toId: 'inconnu',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('introuvable');
    await client.close();
  });
});

describe('confiance et preuves des relations', () => {
  it('« certain » se prouve ; une preuve s’ajoute à la relation, annulable', async () => {
    const root = codeRoot();
    const { context } = workspace();
    fs.writeFileSync(
      path.join(root, 'src', 'api', 'server.ts'),
      "import { cache } from '../cache/redis';",
    );
    const client = await connect(file, false);
    const relation = new RelationTypeService(context).list()[0]!.name;
    const link = async (extra: object) =>
      toon(
        await client.call('nodal_link', {
          sourceId: ids.api,
          targetId: ids.other,
          relation,
          ...extra,
        }),
      );
    const row = async () =>
      toon(await client.call('nodal_get_node', { id: ids.api })).relations.find(
        (item: { otherId: string }) => item.otherId === short(ids.other),
      );
    expect((await link({ confidence: 'certain' })).confidence).toBe('probable');
    expect((await row()).confidence).toBe('probable');
    const missing = await link({
      evidence: { source: 'src/api/server.ts', quote: 'import { base }' },
      confidence: 'certain',
    });
    expect(missing.note).toContain('introuvable');
    expect((await row()).sources).toBe('src/api/server.ts ?');
    const health = toon(await client.call('nodal_health', {}));
    expect(health.counts.doubtfulRelation).toBe(1);

    const proof = {
      source: 'src/api/server.ts:1',
      quote: "import { cache } from '../cache/redis'",
    };
    await link({ evidence: proof, confidence: 'certain' });
    expect(await row()).toMatchObject({
      confidence: 'certain',
      sources: 'src/api/server.ts ? ; src/api/server.ts:1',
    });
    // Moins sûr, ou déjà dit : rien ne change.
    const journal = new AssistantChangeService(context);
    const count = journal.list().length;
    await link({ evidence: proof, confidence: 'uncertain' });
    expect(journal.list()).toHaveLength(count);
    expect((await row()).confidence).toBe('certain');

    journal.undo(journal.list()[0]!.id);
    expect(await row()).toMatchObject({
      confidence: 'probable',
      sources: 'src/api/server.ts ?',
    });
    const weak = toon(
      await client.call('nodal_path', { fromId: ids.api, toId: ids.other }),
    );
    expect(weak.weakest).toBe('probable');
    // Sans rien de nouveau : doublon refusé, comme avant.
    const twice = await client.call('nodal_link', {
      sourceId: ids.api,
      targetId: ids.other,
      relation,
    });
    expect(twice.isError).toBe(true);
    await client.close();
  });
});

describe('mémoire de travail', () => {
  it('note des leçons, les rappelle avec les nœuds, annulables', async () => {
    const { context } = workspace();
    const client = await connect(file, false);
    const note = (extra: object) =>
      client.call('nodal_apply', {
        operations: [
          {
            op: 'lesson',
            question: 'Le déploiement passe par Jenkins ?',
            nodeIds: [short(ids.api)],
            ...extra,
          },
        ],
      });
    expect((await note({ outcome: 'corrected' })).isError).toBe(true);
    toon(await note({ outcome: 'corrected', note: 'Non, par la CI.' }));
    const found = toon(await client.call('nodal_search', { query: 'API' }));
    expect(found.lessons).toEqual([
      {
        outcome: 'corrected',
        question: 'Le déploiement passe par Jenkins ?',
        note: 'Non, par la CI.',
        nodes: 'API',
        date: expect.stringMatching(/^20/),
      },
    ]);
    expect(found.memory).toBeUndefined();
    // Un nœud sans leçon : aucun champ.
    expect(
      toon(await client.call('nodal_get_node', { id: ids.other })).lessons,
    ).toBeUndefined();

    for (const question of ['Où est Redis ?', 'Qui lit le cache ?'])
      toon(await note({ question, outcome: 'useful', nodeIds: [ids.redis] }));
    const node = toon(await client.call('nodal_get_node', { id: ids.redis }));
    expect(node.memory).toMatchObject([
      { id: short(ids.redis), status: 'trusted', useful: 2 },
    ]);
    expect(node.lessons).toBeUndefined();

    const all = toon(await client.call('nodal_lessons', { query: 'jenkins' }));
    expect(all).toMatchObject({ count: 1 });
    const journal = new AssistantChangeService(context);
    const entry = journal
      .list()
      .find((change) => change.summary.includes('Jenkins'))!;
    journal.undo(entry.id);
    expect(
      toon(await client.call('nodal_lessons', { query: 'jenkins' })).count,
    ).toBe(0);
    await client.close();
  });

  it('une leçon devient périmée quand le code ancré change', async () => {
    const root = codeRoot();
    const { context } = workspace();
    setAnchors(context(), ids.api, ['src/api/**']);
    const client = await connect(file, false);
    toon(
      await client.call('nodal_apply', {
        operations: [
          {
            op: 'lesson',
            question: 'Contourner le cache',
            outcome: 'dead_end',
            nodeIds: [ids.api],
          },
        ],
      }),
    );
    const lesson = async () =>
      toon(await client.call('nodal_lessons', {})).lessons[0];
    expect((await lesson()).stale).toBeUndefined();
    fs.writeFileSync(path.join(root, 'src', 'api', 'server.ts'), 'autre');
    expect((await lesson()).stale).toBe(true);
    await client.close();
  });
});

describe('nodal_impact et analyse du graphe', () => {
  it('liste ce qui dépend d’un nœud ou d’un fichier', async () => {
    const { context } = workspace();
    const client = await connect(file);
    // « Isolé » utilise Redis, descendant d'API.
    const data = toon(await client.call('nodal_impact', { nodeId: ids.api }));
    expect(data.affected).toEqual([
      { id: short(ids.other), path: 'Isolé', depth: 1, via: 'utilise Redis' },
    ]);
    writeCodeRoots(context(), [path.join(workspace().dir, 'code')]);
    setAnchors(context(), ids.redis, ['src/redis.ts']);
    const byFile = toon(
      await client.call('nodal_impact', { paths: ['src/redis.ts'] }),
    );
    expect(byFile.of).toEqual([
      { id: short(ids.redis), path: 'API > Cache > Redis' },
    ]);
    expect(byFile.affectedCount).toBe(1);
    expect(
      toon(await client.call('nodal_impact', { paths: ['src/x.ts'] })).note,
    ).toContain('Aucun nœud ancré');
    for (const args of [{}, { nodeId: ids.api, relations: ['inconnue'] }])
      expect((await client.call('nodal_impact', args)).isError).toBe(true);
    await client.close();
  });

  it('analyse le graphe', async () => {
    const client = await connect(file);
    const data = toon(await client.call('nodal_health', { graph: true }));
    expect(Object.keys(data)).toEqual([
      'questions',
      'connections',
      'bridges',
      'redundant',
      'cycles',
    ]);
    await client.close();
  });
});

describe('serveur MCP', () => {
  it('annonce des outils en lecture seule et des instructions', async () => {
    const client = await connect(file);
    expect(client.init.instructions).toContain('TOON');
    const { tools } = (await client.listTools()) as {
      tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
    };
    expect(tools.map((tool) => tool.name).toSorted()).toEqual([
      'nodal_for_files',
      'nodal_get_node',
      'nodal_health',
      'nodal_impact',
      'nodal_lessons',
      'nodal_neighborhood',
      'nodal_overview',
      'nodal_path',
      'nodal_read_document',
      'nodal_search',
      'nodal_tree',
    ]);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint)).toBe(true);
    await client.close();
  });

  it('signale un document JSON invalide sans le refuser', async () => {
    workspace();
    const client = await connect(file, false);
    const json = (body: string) => ({
      op: 'addDocument',
      nodeId: ids.api,
      title: 'Entrée',
      contentType: 'json',
      body,
    });
    const { results } = toon(
      await client.call('nodal_apply', {
        operations: [
          json('{"a": 1}'),
          json('{"a": 1,}'),
          { op: 'updateDocument', id: '$1', body: '{', mode: 'replace' },
          { op: 'updateDocument', id: '$2', body: '{}', mode: 'replace' },
        ],
      }),
    ) as { results: { note?: string }[] };
    expect(
      results.map(({ note }) => note?.includes('JSON invalide') ?? false),
    ).toEqual([false, true, true, false]);
    await client.close();
  });

  it('écrit par nodal_apply seulement, sauf --all-tools', async () => {
    const names = async (allTools: boolean) => {
      const client = await connect(file, false, null, allTools);
      const { tools } = (await client.listTools()) as {
        tools: { name: string }[];
      };
      await client.close();
      return tools.map((tool) => tool.name);
    };
    const few = await names(false);
    expect(few).toContain('nodal_apply');
    expect(few).not.toContain('nodal_create_node');
    expect(await names(true)).toHaveLength(few.length + 6);
  });

  it('propose des commandes ; en lecture seule, celles qui lisent', async () => {
    const list = async (readOnly: boolean) => {
      const client = await connect(file, readOnly);
      const { prompts } = (await client.listPrompts()) as {
        prompts: { name: string }[];
      };
      const text = JSON.stringify(
        await client.getPrompt('avant-modif', { fichiers: 'src/a.ts' }),
      );
      expect(text).toContain('Je vais modifier : src/a.ts');
      await client.close();
      return prompts.map((prompt) => prompt.name);
    };
    expect(await list(true)).toEqual(['explique', 'avant-modif']);
    expect(await list(false)).toEqual([
      'explique',
      'avant-modif',
      'scan',
      'documenter',
      'a-revoir',
      'lecon',
    ]);
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

  it('recherche sans accents : résumé des nœuds et contenu des documents', async () => {
    const client = await connect(file);
    const result = await client.call('nodal_search', { query: 'deploiement' });
    const data = toon(result);
    expect(data.nodeCount).toBe(1);
    expect(data.allTerms).toBeUndefined();
    expect(data.nodes).toEqual([
      {
        id: short(ids.api),
        path: 'API',
        type: 'component',
        summary: 'Expose les commandes',
      },
    ]);
    expect(data.otherMatches).toBeUndefined();
    expect(result.content[1]!.text).toBe(
      `--- document ${short(ids.notes)} « Notes » (markdown) · API\n` +
        '# Déploiement\n\nLe déploiement passe par la CI.\n',
    );
    await client.close();
  });

  it('borne le contenu renvoyé par la recherche', async () => {
    const client = await connect(file);
    // Document court (SQL, 500 caractères) hors budget : cité par un extrait,
    // jamais tronqué.
    const over = toon(
      await client.call('nodal_search', { query: 'select', maxChars: 100 }),
    );
    expect(over.otherMatches[0]).toMatchObject({
      documentId: short(ids.query),
    });
    // Le budget annoncé suffit, sans rien de trop.
    expect(over.maxCharsNeeded).toBeGreaterThan(100);
    const whole = toon(
      await client.call('nodal_search', {
        query: 'select',
        maxChars: over.maxCharsNeeded,
      }),
    );
    expect(whole.otherMatches).toBeUndefined();
    expect(whole.maxCharsNeeded).toBeUndefined();
    // Budget nul : extraits seuls, termes marqués.
    const result = await client.call('nodal_search', {
      query: 'deploiement',
      maxChars: 0,
    });
    expect(result.content).toHaveLength(1);
    const data = toon(result);
    expect(data.otherMatches[0]).toMatchObject({
      nodeId: short(ids.api),
      documentId: short(ids.notes),
      document: 'Notes',
    });
    expect(data.otherMatches[0].snippet).toContain('**Déploiement**');
    expect(data.maxCharsNeeded).toBeUndefined();
    await client.close();
  });

  it('renvoie seulement les sections d’un long document qui contiennent les mots', async () => {
    const documents = new DocumentService(workspace().context);
    const filler =
      'Texte de remplissage sans rapport avec la question. '.repeat(30);
    const body = [
      '# Guide',
      `## Contexte\n\n${filler}`,
      `## Déploiement\n\nLe rollout canari se fait sur Kubernetes.\n\n${filler}`,
      `## Supervision\n\n${filler}`,
    ].join('\n\n');
    const guide = documents.create({
      nodeId: ids.cache,
      title: 'Guide',
      contentType: 'markdown',
    }).id;
    documents.update({ id: guide, body });
    const client = await connect(file);
    const result = await client.call('nodal_search', {
      query: 'rollout canari',
    });
    const text = result.content[1]!.text;
    expect(text).toContain(`--- document ${short(guide)} « Guide » (markdown)`);
    expect(text).toContain(`${body.length} car., sections trouvées`);
    const offset = body.indexOf('## Déploiement');
    expect(text).toContain(`§ Guide > Déploiement (offset ${offset})`);
    expect(text).toContain('Le rollout canari se fait sur Kubernetes.');
    // Les autres sections ne sont pas envoyées.
    expect(text).not.toContain('Supervision');
    expect(text.length).toBeLessThan(body.length / 2);
    // L'offset permet de lire la suite à partir de la section.
    const next = await client.call('nodal_read_document', {
      id: short(guide),
      offset,
      maxChars: 100,
    });
    expect(next.content[1]!.text).toMatch(
      /^## Déploiement\n\nLe rollout canari/,
    );
    await client.close();
  });

  it('ne laisse pas un document court évincer un long document plus pertinent', async () => {
    const documents = new DocumentService(workspace().context);
    // Court et bien classé, mais ne contient qu'un des deux mots.
    const note = documents.create({
      nodeId: ids.redis,
      title: 'Note',
      contentType: 'markdown',
    }).id;
    documents.update({ id: note, body: `Équipe Redis.\n${'x'.repeat(1900)}` });
    const sheet = documents.create({
      nodeId: ids.redis,
      title: 'Fiche',
      contentType: 'markdown',
    }).id;
    documents.update({
      id: sheet,
      body: `# Fiche\n\n## Bascule\n\nLa bascule Redis passe par Sentinel.\n\n${'Remplissage. '.repeat(1000)}`,
    });
    const client = await connect(file);
    const result = await client.call('nodal_search', {
      query: 'redis sentinel',
      maxChars: 2000,
    });
    const texts = result.content.slice(1).map((part) => part.text);
    expect(texts.join('\n')).toContain('La bascule Redis passe par Sentinel.');
    await client.close();
  });

  it('se rabat sur au moins un mot quand aucun nœud ne les contient tous', async () => {
    const client = await connect(file);
    const data = toon(
      await client.call('nodal_search', { query: 'redis deploiement' }),
    );
    expect(data.allTerms).toBe(false);
    expect(data.nodes.map((node: { path: string }) => node.path)).toEqual(
      expect.arrayContaining(['API', 'API > Cache > Redis']),
    );
    await client.close();
  });

  it('demande à Claude Code de charger d’emblée la recherche et l’approfondissement', async () => {
    const client = await connect(file);
    const { tools } = (await client.listTools()) as {
      tools: { name: string; _meta?: Record<string, unknown> }[];
    };
    const loadedUpfront = tools
      // Champ du protocole MCP.
      // oxlint-disable-next-line no-underscore-dangle
      .filter((tool) => tool._meta?.['anthropic/alwaysLoad'])
      .map((tool) => tool.name);
    expect(loadedUpfront.toSorted()).toEqual([
      'nodal_for_files',
      'nodal_get_node',
      'nodal_read_document',
      'nodal_search',
    ]);
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
    expect(api.documents).toEqual([
      expect.objectContaining({ id: short(ids.notes), chars: 47 }),
    ]);
    expect(api.children.map((child: { title: string }) => child.title)).toEqual(
      ['Cache'],
    );
    await client.close();
  });

  it('inclut le contenu des documents courts dans le détail d’un nœud', async () => {
    const client = await connect(file);
    const api = await client.call('nodal_get_node', { id: ids.api });
    expect(api.content[1]!.text).toBe(
      `--- document ${short(ids.notes)} « Notes » (markdown) · API\n` +
        '# Déploiement\n\nLe déploiement passe par la CI.\n',
    );
    // Le document SQL (500 caractères) est court : inclus lui aussi.
    const cache = await client.call('nodal_get_node', { id: ids.cache });
    expect(cache.content).toHaveLength(2);
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
    expect(truncated).toMatchObject({ truncated: true, maxRowsNeeded: 4 });
    expect(truncated.nodes).toHaveLength(2);
    expect(deep.maxRowsNeeded).toBeUndefined();
    const near = toon(
      await client.call('nodal_neighborhood', {
        nodeId: ids.other,
        depth: 2,
        maxNodes: 2,
      }),
    );
    expect(near).toMatchObject({ truncated: true, maxNodesNeeded: 3 });
    expect(near.nodes).toHaveLength(2);

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

describe('fichier d’une version plus récente de Nodal', () => {
  it('reste lisible, mais refuse toute écriture', async () => {
    const { context } = workspace();
    context().db.exec('PRAGMA user_version = 999');
    const client = await connect(file, false);
    const found = toon(await client.call('nodal_search', { query: 'API' }));
    expect(found.nodeCount).toBeGreaterThan(0);
    const write = await client.call('nodal_create_node', {
      title: 'X',
      type: 'concept',
    });
    expect(write.isError).toBe(true);
    expect(write.content[0]!.text).toContain('version plus récente de Nodal');
    expect(write.content[0]!.text).toContain('lecture seule');
    await client.close();
  });
});

describe('fichier d’une version précédente de Nodal', () => {
  it('est mis à jour par le serveur, même en lecture seule', async () => {
    const { dir } = workspace();
    const old = path.join(dir, 'ancien.nodal');
    const db = new DatabaseSync(old);
    db.exec(`PRAGMA application_id = ${NODAL_APPLICATION_ID}`);
    db.exec('PRAGMA journal_mode = WAL');
    runMigrations(db, MIGRATIONS.slice(0, LATEST_SCHEMA_VERSION - 1));
    db.exec(
      "INSERT INTO workspace VALUES ('w', 'Ancien', NULL, 't', 't');" +
        "INSERT INTO node (id, workspace_id, title, node_type, summary, created_at, updated_at) VALUES ('n', 'w', 'Passerelle', 'component', 'Entrée HTTP', 't', 't');",
    );
    db.close();

    const client = await connect(old);
    const found = toon(
      await client.call('nodal_search', { query: 'passerelle' }),
    );
    expect(found.nodeCount).toBe(1);
    await client.close();

    const after = new DatabaseSync(old);
    expect(getSchemaVersion(after)).toBe(LATEST_SCHEMA_VERSION);
    after.close();
  });
});

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
      'nodal_apply',
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

describe('nodal_apply : écriture groupée', () => {
  it('enregistre une notion complète en un appel, avec des références $n', async () => {
    const client = await connect(file, false);
    const data = toon(
      await client.call('nodal_apply', {
        operations: [
          {
            op: 'createNode',
            title: 'Éviction',
            type: 'concept',
            parentId: short(ids.redis),
            summary: 'Politique LRU.',
          },
          {
            op: 'addDocument',
            nodeId: '$1',
            title: 'Détail',
            contentType: 'markdown',
            body: '# LRU\n',
          },
          {
            op: 'link',
            sourceId: '$1',
            targetId: ids.api,
            relation: 'utilise',
          },
          { op: 'tag', nodeId: '$1', add: ['perf'] },
          {
            op: 'updateDocument',
            id: '$2',
            body: 'Clés les moins utilisées.',
          },
        ],
      }),
    );
    expect(data.applied).toBe(5);
    expect(data.results.map((row: { op: string }) => row.op)).toEqual([
      'createNode',
      'addDocument',
      'link',
      'tag',
      'updateDocument',
    ]);
    const [node, doc] = data.results as { ref: string; id: string }[];
    expect(node!.ref).toBe('$1');
    // Identifiants abrégés, comme dans les autres réponses.
    expect(node!.id).toHaveLength(8);
    const detail = new NodeService(workspace().context).get(full(node!.id));
    expect(detail.summary).toBe('Politique LRU.');
    expect(detail.tags.map((tag) => tag.name)).toEqual(['perf']);
    expect(
      new DocumentService(workspace().context).get(full(doc!.id)).body,
    ).toBe('# LRU\n\nClés les moins utilisées.');
    // Chaque opération est journalisée comme avec les outils unitaires.
    expect(
      changes()
        .map((change) => change.action)
        .toSorted(),
    ).toEqual([
      'create_document',
      'create_node',
      'link',
      'tag',
      'update_document',
    ]);
    await client.close();
  });

  it('annule tout et nomme l’opération fautive en cas d’erreur', async () => {
    const client = await connect(file, false);
    const before = new NodeService(workspace().context).list().length;
    const result = await client.call('nodal_apply', {
      operations: [
        { op: 'createNode', title: 'Orphelin', type: 'concept' },
        {
          op: 'link',
          sourceId: '$1',
          targetId: ids.api,
          relation: 'inexistante',
        },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(
      /^Opération 2 \(link\) : Type de relation « inexistante » inconnu.*Rien n'a été enregistré\.$/s,
    );
    expect(new NodeService(workspace().context).list()).toHaveLength(before);
    expect(changes()).toEqual([]);
    await client.close();
  });

  it('crée un nœud depuis un modèle et renvoie son document', async () => {
    const client = await connect(file, false);
    const data = toon(
      await client.call('nodal_apply', {
        operations: [
          {
            op: 'createNode',
            title: 'Basculer la base',
            type: 'procedure',
            template: 'Procédure',
          },
        ],
      }),
    );
    const [created] = data.results as { id: string; documentId: string }[];
    expect(created!.documentId).toHaveLength(8);
    const node = new NodeService(workspace().context).get(full(created!.id));
    expect(node.documents.map((doc) => doc.title)).toEqual(['Procédure']);
    const body = new DocumentService(workspace().context).get(
      full(created!.documentId),
    ).body;
    expect(body).toContain('## Retour arrière');
    // Nœud et document journalisés, annulables séparément.
    expect(changes().map((change) => change.action)).toEqual([
      'create_document',
      'create_node',
    ]);
    await client.close();
  });

  it('refuse un modèle inconnu en listant ceux de l’espace', async () => {
    const client = await connect(file, false);
    const result = await client.call('nodal_create_node', {
      title: 'X',
      type: 'concept',
      template: 'Inconnu',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(
      "Modèle « Inconnu » introuvable. Modèles de l'espace : « Procédure »",
    );
    expect(changes()).toEqual([]);
    await client.close();
  });

  it('refuse une référence à une opération qui n’a pas encore eu lieu', async () => {
    const client = await connect(file, false);
    const result = await client.call('nodal_apply', {
      operations: [
        { op: 'createNode', title: 'A', type: 'concept', parentId: '$1' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain(
      'Opération 1 (createNode) : référence $1 invalide',
    );
    await client.close();
  });

  it('permet d’annuler une opération depuis l’activité IA', async () => {
    const client = await connect(file, false);
    toon(
      await client.call('nodal_apply', {
        operations: [
          {
            op: 'link',
            sourceId: ids.cache,
            targetId: ids.api,
            relation: 'utilise',
          },
        ],
      }),
    );
    const [entry] = changes();
    const service = new AssistantChangeService(workspace().context);
    service.undo(entry!.id);
    expect(
      new EdgeService(workspace().context)
        .listForNode(ids.cache)
        .filter((relation) => relation.direction === 'outgoing'),
    ).toEqual([]);
    await client.close();
  });

  it('n’existe pas en lecture seule', async () => {
    const client = await connect(file);
    await expect(
      client.call('nodal_apply', {
        operations: [{ op: 'createNode', title: 'X', type: 'concept' }],
      }),
    ).rejects.toThrow(/not found/);
    await client.close();
  });
});

describe('validation de ce qu’a ajouté l’IA', () => {
  it('fait passer un nœud de « assistant » à « user », historique conservé', async () => {
    const client = await connect(file, false);
    const created = toon(
      await client.call('nodal_create_node', {
        title: 'Hypothèse',
        type: 'concept',
      }),
    );
    const id = full(created.id);
    const nodes = new NodeService(workspace().context);
    expect(nodes.list().find((node) => node.id === id)?.assistantPending).toBe(
      true,
    );
    expect(
      new GraphService(workspace().context)
        .get()
        .nodes.find((node) => node.id === id)?.assistantPending,
    ).toBe(true);

    const journal = new AssistantChangeService(workspace().context);
    expect(journal.validateNodes([id, id, ids.api])).toBe(1);
    // Déjà validé : rien à faire.
    expect(journal.validateNodes([id])).toBe(0);

    expect(nodes.get(id).createdByAssistant).toBeNull();
    expect(nodes.list().find((node) => node.id === id)?.assistantPending).toBe(
      false,
    );
    const detail = toon(
      await client.call('nodal_get_node', { id: created.id }),
    );
    expect(detail.node.createdBy).toBe('user');
    expect(
      toon(await client.call('nodal_overview')).stats.nodesByAssistant,
    ).toBe(0);
    // L'entrée reste dans le journal, marquée validée, et reste annulable.
    const [entry] = changes();
    expect(entry).toMatchObject({ action: 'create_node', undoneAt: null });
    expect(entry!.validatedAt).toEqual(expect.any(String));
    journal.undo(entry!.id);
    expect(nodes.list().some((node) => node.id === id)).toBe(false);
    await client.close();
  });
});

/** Dossier de code déclaré pour l'espace, avec un fichier modifié bien après. */
function codeRoot() {
  const { context, dir } = workspace();
  const root = path.join(dir, 'code');
  const write = (relative: string, mtime: Date) => {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x');
    fs.utimesSync(target, mtime, mtime);
  };
  write('src/api/server.ts', new Date('2027-01-01T00:00:00Z'));
  write('src/cache/redis.ts', new Date('2026-01-01T00:00:00Z'));
  writeCodeRoots(context(), [root]);
  return root;
}

describe('fichiers du code (ancrage)', () => {
  it('ancre des fichiers par nodal_apply, journalisé et annulable', async () => {
    const root = codeRoot();
    const client = await connect(file, false);
    const applied = toon(
      await client.call('nodal_apply', {
        operations: [
          {
            op: 'anchor',
            nodeId: short(ids.api),
            add: [path.join(root, 'src', 'api', 'server.ts'), 'src/api/**'],
          },
        ],
      }),
    );
    expect(applied.results).toEqual([
      { ref: '$1', op: 'anchor', id: short(ids.api) },
    ]);
    const { context } = workspace();
    expect(listAnchors(context(), ids.api)).toEqual([
      'src/api/server.ts',
      'src/api/**',
    ]);
    const outside = await client.call('nodal_apply', {
      operations: [
        { op: 'anchor', nodeId: ids.api, add: [path.join(file, '..', 'x.ts')] },
      ],
    });
    expect(outside.isError).toBe(true);
    expect(outside.content[0]!.text).toContain(
      "n'est dans aucun dossier de code",
    );

    const journal = new AssistantChangeService(context);
    const entry = journal.list().find((change) => change.action === 'anchor')!;
    expect(entry.summary).toContain('src/api/server.ts, src/api/**');
    journal.undo(entry.id);
    expect(listAnchors(context(), ids.api)).toEqual([]);
  });

  it('prend le dossier du projet quand l’espace ne déclare aucun dossier de code', async () => {
    const root = codeRoot();
    const { context } = workspace();
    writeCodeRoots(context(), []);
    setAnchors(context(), ids.api, ['src/api/**']);
    const without = toon(
      await (
        await connect(file)
      ).call('nodal_for_files', {
        paths: ['src/api/server.ts'],
      }),
    );
    expect(without.nodeCount).toBe(0);
    const client = await connect(file, true, root);
    const data = toon(
      await client.call('nodal_for_files', {
        paths: ['src/api/server.ts'],
        maxChars: 0,
      }),
    );
    expect(data.nodes.map((node: { id: string }) => node.id)).toEqual([
      short(ids.api),
    ]);
    // Rien n'est écrit dans la base.
    expect(readCodeRoots(context())).toEqual([]);
    await client.close();
  });

  it('nodal_for_files renvoie les nœuds ancrés et signale la documentation obsolète', async () => {
    const root = codeRoot();
    const { context } = workspace();
    setAnchors(context(), ids.api, ['src/api/**']);
    setAnchors(context(), ids.cache, ['src/cache/redis.ts']);
    const client = await connect(file);
    const result = await client.call('nodal_for_files', {
      paths: [
        path.join(root, 'src', 'api', 'server.ts'),
        'src/cache/redis.ts',
        'src/autre.ts',
      ],
      maxChars: 100,
    });
    const data = toon(result);
    expect(data.nodes).toEqual([
      {
        id: short(ids.api),
        path: 'API',
        type: 'component',
        summary: 'Expose les commandes',
        files: 'src/api/server.ts',
      },
      {
        id: short(ids.cache),
        path: 'API > Cache',
        type: 'data',
        summary: null,
        files: 'src/cache/redis.ts',
      },
    ]);
    expect(data.notAnchored).toBe('src/autre.ts');
    // Seule l'API a un fichier modifié après sa dernière mise à jour.
    expect(data.stale).toEqual([
      {
        id: short(ids.api),
        since: expect.stringMatching(/^2026-/),
        changed: 'src/api/server.ts',
      },
    ]);
    // Documents : le court en entier, le long cité.
    expect(result.content[1]!.text).toContain(
      'Le déploiement passe par la CI.',
    );
    expect(data.otherDocuments).toEqual([
      {
        nodeId: short(ids.cache),
        id: short(ids.query),
        title: 'Requête',
        chars: 500,
      },
    ]);

    // Le même champ dans la recherche et le détail du nœud.
    expect(
      toon(await client.call('nodal_search', { query: 'API' })).stale,
    ).toHaveLength(1);
    const node = toon(await client.call('nodal_get_node', { id: ids.api }));
    expect(node.node.anchors).toBe('src/api/**');
    expect(node.node.stale).toMatch(/^depuis 2026-.* : src\/api\/server\.ts$/);
    expect(
      toon(await client.call('nodal_get_node', { id: ids.cache })).node.stale,
    ).toBeUndefined();
    // Et dans la santé de la base.
    const health = toon(await client.call('nodal_health', {}));
    expect(health.counts.stale).toBe(1);
    expect(health.issues).toContainEqual({
      check: 'stale',
      id: short(ids.api),
      path: 'API',
      detail: 'src/api/server.ts',
    });
  });

  it('mettre un nœud à jour ne prouve pas que ses fichiers ont été relus', async () => {
    const root = codeRoot();
    const { context } = workspace();
    const source = path.join(root, 'src', 'api', 'server.ts');
    setAnchors(context(), ids.api, ['src/api/**']);
    const client = await connect(file, false);
    const update = async (extra: object[] = []) =>
      toon(
        await client.call('nodal_apply', {
          operations: [
            { op: 'updateNode', id: ids.api, summary: `Résumé ${Date.now()}` },
            ...extra,
          ],
        }),
      );
    const staleCount = async () =>
      toon(await client.call('nodal_health', {})).counts.stale;
    expect((await update()).stale).toEqual([
      {
        id: short(ids.api),
        since: expect.any(String),
        changed: 'src/api/server.ts',
      },
    ]);
    expect(await staleCount()).toBe(1);

    const review = { op: 'review', nodeId: ids.api, files: [source] };
    expect((await update([review])).stale).toBeUndefined();
    expect(await staleCount()).toBe(0);

    // Journalisé et annulable : le fichier est de nouveau à relire.
    const journal = new AssistantChangeService(context);
    const entry = journal.list().find((change) => change.action === 'review')!;
    expect(entry.summary).toContain('src/api/server.ts');
    journal.undo(entry.id);
    expect(await staleCount()).toBe(1);

    const refused = await client.call('nodal_apply', {
      operations: [{ ...review, files: ['src/autre.ts'] }],
    });
    expect(refused.isError).toBe(true);
    await client.close();
  });

  it('un fichier vu par le hook dans son état actuel est tenu pour lu', async () => {
    const root = codeRoot();
    const { context } = workspace();
    const source = path.join(root, 'src', 'api', 'server.ts');
    setAnchors(context(), ids.api, ['src/api/**']);
    const client = await connect(file, false);
    const update = async () =>
      toon(
        await client.call('nodal_apply', {
          operations: [
            { op: 'updateNode', id: ids.api, summary: `Résumé ${Date.now()}` },
          ],
        }),
      ).stale;
    const hook = (tool_name: string) =>
      contextHookOutput(
        file,
        JSON.stringify({
          hook_event_name: 'PreToolUse',
          tool_name,
          cwd: root,
          tool_input: { file_path: source },
        }),
      );
    try {
      hook('Read');
      fs.writeFileSync(source, 'changé après la lecture');
      expect(await update()).toHaveLength(1);
      // Le hook dit que la fiche peut être dépassée.
      expect(hook('Read')).toContain('changed');
      expect(await update()).toBeUndefined();
      hook('Edit');
      fs.writeFileSync(source, 'modifié par l’assistant');
      expect(await update()).toBeUndefined();
    } finally {
      fs.rmSync(readLogFile(file), { force: true });
    }
    await client.close();
  });

  it('dit qu’aucun dossier de code n’est déclaré', async () => {
    const client = await connect(file);
    const data = toon(
      await client.call('nodal_for_files', { paths: ['src/a.ts'] }),
    );
    expect(data.nodeCount).toBe(0);
    expect(data.note).toContain('Aucun dossier de code');
    expect(toon(await client.call('nodal_health', {})).counts.stale).toBe(
      undefined,
    );
  });
});
