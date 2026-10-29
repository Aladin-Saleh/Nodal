/**
 * Mesures à l'échelle visée (§9 : « quelques milliers de nœuds »).
 * Lancement : npm run test:perf
 */
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { DocumentService } from '../../src/main/knowledge/document-service';
import { exportWorkspace } from '../../src/main/knowledge/export-service';
import { GraphService } from '../../src/main/knowledge/graph-service';
import {
  buildLlmExport,
  createDefaultTokenizer,
} from '../../src/main/knowledge/llm-export-service';
import { NodeService } from '../../src/main/knowledge/node-service';
import { SearchService } from '../../src/main/knowledge/search-service';
import { inTransaction } from '../../src/main/database/transaction';
import { testWorkspaceFixture } from '../helpers/test-workspace';

const NODES = 3000;
const DOCS_PER_NODE = 2;
const EDGES = 4000;

const workspace = testWorkspaceFixture();

/** Durée médiane (ms) de `runs` exécutions. */
function median(runs: number, fn: () => void): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)]!;
}

const LOREM =
  'Le service publie des événements de commande vers Kafka puis met à jour la base PostgreSQL. ' +
  'Les consommateurs calculent la facturation et alimentent les tableaux de bord.';

describe(`échelle : ${NODES} nœuds, ${NODES * DOCS_PER_NODE} documents, ${EDGES} relations`, () => {
  it('reste fluide pour les opérations courantes', async () => {
    const { context, dir, service } = workspace();
    const ctx = context();
    const nodes = new NodeService(context);
    const documents = new DocumentService(context);
    const ids: string[] = [];

    const seedStart = performance.now();
    inTransaction(ctx.db, () => {
      const insertNode = ctx.db.prepare(
        `INSERT INTO node (id, workspace_id, parent_id, title, node_type, summary, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'component', ?, ?, ?, ?)`,
      );
      const insertDoc = ctx.db.prepare(
        `INSERT INTO document (id, node_id, title, content_type, language, body, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertEdge = ctx.db.prepare(
        `INSERT INTO edge (id, workspace_id, source_node_id, target_node_id, relation_type_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const relationType = (
        ctx.db.prepare('SELECT id FROM relation_type LIMIT 1').get() as {
          id: string;
        }
      ).id;
      const now = ctx.now();
      for (let i = 0; i < NODES; i++) {
        const id = ctx.newId();
        const parent = i > 10 ? ids[Math.floor(i / 10)]! : null;
        insertNode.run(
          id,
          ctx.workspaceId,
          parent,
          `Composant ${i}`,
          `Résumé ${i}`,
          i,
          now,
          now,
        );
        ids.push(id);
        insertDoc.run(
          ctx.newId(),
          id,
          'Notes',
          'markdown',
          null,
          `# Composant ${i}\n\n${LOREM}\n\nRéférence unique ref${i}x.`,
          0,
          now,
          now,
        );
        insertDoc.run(
          ctx.newId(),
          id,
          'Requête',
          'code',
          'sql',
          `SELECT * FROM table_${i} WHERE id = ${i};`,
          1,
          now,
          now,
        );
      }
      for (let i = 0; i < EDGES; i++) {
        insertEdge.run(
          ctx.newId(),
          ctx.workspaceId,
          ids[i % NODES]!,
          ids[(i * 7 + 13) % NODES]!,
          relationType,
          now,
          now,
        );
      }
    });
    const seedMs = performance.now() - seedStart;

    const search = new SearchService(context);
    const results: Record<string, number> = {
      'création du jeu de données (une transaction)': seedMs,
      'recherche 1 mot fréquent (kafka)': median(5, () =>
        search.search('kafka'),
      ),
      'recherche mot rare (ref2999x)': median(5, () =>
        search.search('ref2999x'),
      ),
      'recherche 2 mots (commande facturation)': median(5, () =>
        search.search('commande facturation'),
      ),
      'recherche dans le code (table_1500)': median(5, () =>
        search.search('table_1500'),
      ),
      'liste des nœuds (arborescence)': median(5, () => nodes.list()),
      'données du graphe': median(5, () => new GraphService(context).get()),
      'fiche d’un nœud': median(5, () => nodes.get(ids[1500]!)),
    };
    const doc = documents.create({
      nodeId: ids[1500]!,
      title: 'Brouillon',
      contentType: 'markdown',
    });
    let n = 0;
    results['enregistrement automatique d’un document (index FTS compris)'] =
      median(20, () => {
        documents.update({ id: doc.id, body: `Texte modifié ${n++} ${LOREM}` });
      });
    results['renommage d’un nœud (index FTS compris)'] = median(10, () => {
      nodes.update({ id: ids[42]!, title: `Composant renommé ${n++}` });
    });
    const exportStart = performance.now();
    await exportWorkspace(ctx, service.getCurrent()!, dir, {
      name: 'Nodal',
      version: 'perf',
    });
    results['export portable complet'] = performance.now() - exportStart;
    const words = {
      info: { name: 'w', version: '1', encoding: 'w', targetModel: null },
      count: (t: string) => t.split(/\s+/).length,
    };
    const llmStart = performance.now();
    buildLlmExport(
      ctx,
      service.getCurrent()!,
      { scope: { kind: 'workspace' }, maxTokens: 400 },
      words,
    );
    results['export LLM (sans tokenizer réel)'] = performance.now() - llmStart;
    const tokenizer = await createDefaultTokenizer();
    const realStart = performance.now();
    buildLlmExport(
      ctx,
      service.getCurrent()!,
      { scope: { kind: 'workspace' }, maxTokens: 400 },
      tokenizer,
    );
    results['export LLM (tokenizer o200k_base)'] =
      performance.now() - realStart;

    console.table(
      Object.fromEntries(
        Object.entries(results).map(([k, v]) => [k, `${v.toFixed(1)} ms`]),
      ),
    );
    void path;

    // Seuils : une interaction ne doit pas bloquer de façon perceptible.
    expect(results['recherche 1 mot fréquent (kafka)']!).toBeLessThan(150);
    expect(results['recherche 2 mots (commande facturation)']!).toBeLessThan(
      200,
    );
    expect(results['données du graphe']!).toBeLessThan(150);
    expect(
      results['enregistrement automatique d’un document (index FTS compris)']!,
    ).toBeLessThan(30);
    expect(results['fiche d’un nœud']!).toBeLessThan(30);
  }, 120_000);
});
