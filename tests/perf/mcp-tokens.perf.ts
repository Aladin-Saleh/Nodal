/**
 * Coût en tokens des réponses du serveur MCP (docs/benchmark-tokens-mcp.md) :
 * réponses réellement servies par `tools/call`, comptées avec o200k_base.
 * Espace « échelle ×1 » : 10 racines × 6 composants × 4 éléments = 310 nœuds,
 * 60 résumés, 60 documents, jusqu'à 400 relations (générateur pseudo-aléatoire
 * à graine fixe : mêmes données à chaque exécution, UUID mis à part).
 * Lancement : npm run test:perf -- mcp-tokens
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/main/database/transaction';
import {
  setAnchors,
  writeCodeRoots,
} from '../../src/main/knowledge/anchor-service';
import { DocumentService } from '../../src/main/knowledge/document-service';
import { createDefaultTokenizer } from '../../src/main/knowledge/llm-export-service';
import { formatNodeLink } from '../../src/shared/wiki-links';
import { connect } from '../helpers/mcp-client';
import { testWorkspaceFixture } from '../helpers/test-workspace';

const workspace = testWorkspaceFixture();

/** Générateur congruentiel à graine fixe (reproductible). */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** Espace ×1 ; renvoie les identifiants par rôle. */
export function seedScaleOne(
  ctx: ReturnType<ReturnType<typeof workspace>['context']>,
) {
  const next = random(42);
  const roots: string[] = [];
  const components: string[] = [];
  const elements: string[] = [];
  inTransaction(ctx.db, () => {
    const now = ctx.now();
    const insertNode = ctx.db.prepare(
      `INSERT INTO node (id, workspace_id, parent_id, title, node_type, summary, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertDoc = ctx.db.prepare(
      `INSERT INTO document (id, node_id, title, content_type, language, body, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Notes', 'markdown', NULL, ?, 0, ?, ?)`,
    );
    const types = ctx.db
      .prepare('SELECT id FROM relation_type ORDER BY rowid')
      .all() as { id: string }[];
    const node = (
      parent: string | null,
      title: string,
      type: string,
      order: number,
      summary: string | null,
    ) => {
      const id = ctx.newId();
      insertNode.run(
        id,
        ctx.workspaceId,
        parent,
        title,
        type,
        summary,
        order,
        now,
        now,
      );
      return id;
    };
    for (let r = 0; r < 10; r++) {
      const root = node(null, `Domaine ${r}`, 'concept', r, null);
      roots.push(root);
      for (let c = 0; c < 6; c++) {
        const component = node(
          root,
          `Service ${r}.${c}`,
          'component',
          c,
          `Service ${c} du domaine ${r}, expose une API interne.`,
        );
        components.push(component);
        insertDoc.run(
          ctx.newId(),
          component,
          `# Service ${r}.${c}\n\nDéploiement continu, file de messages et cache.`,
          now,
          now,
        );
        for (let e = 0; e < 4; e++) {
          elements.push(
            node(component, `Élément ${r}.${c}.${e}`, 'data', e, null),
          );
        }
      }
    }
    const all = [...components, ...elements];
    const insertEdge = ctx.db.prepare(
      `INSERT OR IGNORE INTO edge (id, workspace_id, source_node_id, target_node_id, relation_type_id, label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < 400; i++) {
      const source = all[Math.floor(next() * all.length)]!;
      const target = all[Math.floor(next() * all.length)]!;
      if (source === target) continue;
      const type = types[Math.floor(next() * types.length)]!.id;
      insertEdge.run(
        ctx.newId(),
        ctx.workspaceId,
        source,
        target,
        type,
        i % 3 === 0 ? `lien ${i}` : null,
        now,
        now,
      );
    }
  });
  return { roots, components, elements };
}

describe('tokens des réponses MCP (échelle ×1)', () => {
  it('mesure nodal_path', async () => {
    const { context, service } = workspace();
    const ids = seedScaleOne(context());
    const client = await connect(service.getCurrent()!.filePath);
    const { count } = await createDefaultTokenizer();
    const measures: [string, number][] = [];
    const measure = async (label: string, tool: string, args: object) => {
      const result = await client.call(tool, args as Record<string, unknown>);
      expect(result.isError).toBeFalsy();
      const tokens = result.content.reduce(
        (sum, part) => sum + count(part.text),
        0,
      );
      measures.push([label, tokens]);
      return result.content[0]!.text;
    };
    await measure(
      'nodal_neighborhood depth 2 (référence)',
      'nodal_neighborhood',
      {
        nodeId: ids.components[0],
        depth: 2,
      },
    );
    const related = await measure('nodal_path relations', 'nodal_path', {
      fromId: ids.components[0],
      toId: ids.components[59],
    });
    await measure('nodal_path avec hiérarchie', 'nodal_path', {
      fromId: ids.elements[0],
      toId: ids.elements[239],
      includeHierarchy: true,
    });
    await measure('nodal_path sans chemin', 'nodal_path', {
      fromId: ids.roots[0],
      toId: ids.roots[9],
    });
    // Écrit directement : la sortie console des tests réussis est masquée.
    const lines = measures.map(([label, tokens]) => `${label} : ${tokens}`);
    process.stdout.write(['', related, '', ...lines, ''].join('\n'));
    await client.close();
  });

  it('mesure les liens [[...]] servis et les rétroliens', async () => {
    const { context, service } = workspace();
    const ids = seedScaleOne(context());
    const ctx = context();
    // Le premier service cite trois autres services ; dix services le citent.
    const docOf = (nodeId: string) =>
      (
        ctx.db
          .prepare('SELECT id FROM document WHERE node_id = ?')
          .get(nodeId) as { id: string }
      ).id;
    const documents = new DocumentService(context);
    const rawBody = `# Service 0.0

Appelle ${formatNodeLink(ids.components[1]!)}, ${formatNodeLink(ids.components[7]!, 'la file')} et ${formatNodeLink(ids.components[13]!)}.`;
    documents.update({ id: docOf(ids.components[0]!), body: rawBody });
    for (let i = 20; i < 30; i++) {
      documents.update({
        id: docOf(ids.components[i]!),
        body: `Dépend de ${formatNodeLink(ids.components[0]!)} pour le cache.`,
      });
    }
    const client = await connect(service.getCurrent()!.filePath);
    const { count } = await createDefaultTokenizer();
    const read = await client.call('nodal_read_document', {
      id: docOf(ids.components[0]!),
    });
    const served = read.content[1]!.text;
    const node = await client.call('nodal_get_node', {
      id: ids.components[0],
    });
    const mentions = node.content[0]!.text.slice(
      node.content[0]!.text.indexOf('mentionedIn'),
    );
    const lines = [
      `document brut (UUID) : ${count(rawBody)}`,
      `document servi ([[Titre]](id)) : ${count(served)}`,
      `rubrique mentionedIn (10 lignes) : ${count(mentions)}`,
    ];
    const output = ['', served, '', mentions, '', ...lines, ''];
    process.stdout.write(output.join('\n'));
    expect(count(served)).toBeLessThan(count(rawBody));
    await client.close();
  });

  it('mesure nodal_health et les consignes', async () => {
    const { context, service } = workspace();
    seedScaleOne(context());
    const client = await connect(service.getCurrent()!.filePath, false);
    const { count } = await createDefaultTokenizer();
    for (const query of [
      'rollback canari',
      'quota disque',
      'rollback canari',
    ]) {
      await client.call('nodal_search', { query });
    }
    const health = await client.call('nodal_health', {});
    const instructions = String(client.init.instructions);
    expect(health.isError).toBeFalsy();
    const lines = [
      `nodal_health (limit 10) : ${count(health.content[0]!.text)}`,
      `consignes du serveur (écriture) : ${count(instructions)}`,
    ];
    const output = ['', health.content[0]!.text.slice(0, 700), '', ...lines];
    process.stdout.write(output.join('\n'));
    await client.close();
  });
});

/** Texte complet d'une réponse (TOON et documents). */
const text = (result: { content: { text: string }[] }) =>
  result.content.map((part) => part.text).join('\n');

describe('tokens : fichiers du code (ancrage)', () => {
  it('mesure nodal_for_files, le champ stale et les consignes', async () => {
    const { context, service, dir } = workspace();
    const { components } = seedScaleOne(context());
    // Dossier de code : un dossier par service, deux fichiers chacun ; les
    // dix premiers services ont un fichier modifié bien après la mise à jour.
    const root = path.join(dir, 'code');
    components.forEach((id, index) => {
      const folder = path.join(root, 'src', `service-${index}`);
      fs.mkdirSync(folder, { recursive: true });
      for (const name of ['index.ts', 'handler.ts']) {
        const file = path.join(folder, name);
        fs.writeFileSync(file, 'export {};\n');
        const mtime = new Date(
          index < 10 && name === 'handler.ts' ? '2030-01-01' : '2020-01-01',
        );
        fs.utimesSync(file, mtime, mtime);
      }
    });
    const ctx = context();
    writeCodeRoots(ctx, [root]);
    const client = await connect(service.getCurrent()!.filePath, false);
    const { count } = await createDefaultTokenizer();
    const before = await client.call('nodal_get_node', { id: components[0] });
    const search = await client.call('nodal_search', { query: 'Service 0.0' });
    inTransaction(ctx.db, () =>
      components.forEach((id, index) =>
        setAnchors(ctx, id, [`src/service-${index}/**`]),
      ),
    );
    const files = [
      path.join(root, 'src', 'service-0', 'handler.ts'),
      path.join(root, 'src', 'service-1', 'index.ts'),
      path.join(root, 'src', 'autre.ts'),
    ];
    let start = performance.now();
    const forFiles = await client.call('nodal_for_files', { paths: files });
    const forFilesMs = performance.now() - start;
    const after = await client.call('nodal_get_node', { id: components[0] });
    const searchAfter = await client.call('nodal_search', {
      query: 'Service 0.0',
    });
    start = performance.now();
    const health = await client.call('nodal_health', {});
    const healthMs = performance.now() - start;
    const readOnly = await connect(service.getCurrent()!.filePath, true);
    const lines = [
      `nodal_for_files (3 chemins, 2 nœuds, documents inclus) : ${count(text(forFiles))} (${forFilesMs.toFixed(0)} ms)`,
      `nodal_get_node sans ancrage : ${count(text(before))}`,
      `nodal_get_node ancré et obsolète : ${count(text(after))}`,
      `nodal_search sans ancrage : ${count(text(search))}`,
      `nodal_search avec stale : ${count(text(searchAfter))}`,
      `nodal_health (60 nœuds ancrés, 10 obsolètes) : ${count(health.content[0]!.text)} (${healthMs.toFixed(0)} ms)`,
      `consignes (lecture seule) : ${count(String(readOnly.init.instructions))}`,
      `consignes (écriture) : ${count(String(client.init.instructions))}`,
    ];
    const output = [
      '',
      forFiles.content[0]!.text,
      '',
      after.content[0]!.text.split('\n').slice(0, 14).join('\n'),
      '',
      ...lines,
      '',
    ];
    process.stdout.write(output.join('\n'));
    expect(forFiles.isError).toBeFalsy();
    await client.close();
    await readOnly.close();
  });
});

describe('tokens : modèles de documents', () => {
  it('mesure le champ template et la réponse de création', async () => {
    const { context, service } = workspace();
    seedScaleOne(context());
    const client = await connect(service.getCurrent()!.filePath, false);
    const { count } = await createDefaultTokenizer();
    const { tools } = (await client.listTools()) as {
      tools: {
        name: string;
        description?: string;
        inputSchema: Record<string, unknown>;
      }[];
    };
    /** Définition d'un outil telle que servie, avec ou sans `template`. */
    const definition = (name: string, withTemplate: boolean) => {
      const tool = structuredClone(tools.find((t) => t.name === name)!);
      if (!withTemplate) {
        const strip = (value: unknown): void => {
          if (!value || typeof value !== 'object') return;
          const record = value as Record<string, unknown>;
          const properties = record.properties as
            | Record<string, unknown>
            | undefined;
          if (properties) delete properties.template;
          Object.values(record).forEach(strip);
        };
        strip(tool.inputSchema);
      }
      return count(JSON.stringify(tool));
    };
    const plain = await client.call('nodal_create_node', {
      title: 'Sans modèle',
      type: 'procedure',
    });
    const templated = await client.call('nodal_create_node', {
      title: 'Avec modèle',
      type: 'procedure',
      template: 'Procédure',
    });
    expect(templated.isError).toBeFalsy();
    expect(text(templated)).toContain('documentId');
    const lines = [
      `nodal_create_node (définition) : ${definition('nodal_create_node', false)} → ${definition('nodal_create_node', true)}`,
      `nodal_apply (définition) : ${definition('nodal_apply', false)} → ${definition('nodal_apply', true)}`,
      `réponse sans modèle : ${count(text(plain))}`,
      `réponse avec modèle : ${count(text(templated))}`,
    ];
    process.stdout.write(['', text(templated), '', ...lines].join('\n'));
    await client.close();
  });
});
