/**
 * Coût en tokens des réponses du serveur MCP (docs/benchmark-tokens-mcp.md) :
 * réponses réellement servies par `tools/call`, comptées avec o200k_base.
 * Espace « échelle ×1 » : 10 racines × 6 composants × 4 éléments = 310 nœuds,
 * 60 résumés, 60 documents, jusqu'à 400 relations (générateur pseudo-aléatoire
 * à graine fixe : mêmes données à chaque exécution, UUID mis à part).
 * Lancement : npm run test:perf -- mcp-tokens
 */
import { describe, expect, it } from 'vitest';
import { inTransaction } from '../../src/main/database/transaction';
import { createDefaultTokenizer } from '../../src/main/knowledge/llm-export-service';
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
});
