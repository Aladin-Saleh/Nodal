import { describe, expect, it } from 'vitest';
import { AssistantChangeService } from '../../../src/main/knowledge/assistant-change-service';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { EdgeService } from '../../../src/main/knowledge/edge-service';
import {
  duplicatePairs,
  healthReport,
  listSearchGaps,
  recordSearchGap,
  SEARCH_GAP_LIMIT,
  setSearchGapStatus,
  titleKey,
} from '../../../src/main/knowledge/health-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { RelationTypeService } from '../../../src/main/knowledge/relation-type-service';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

describe('doublons probables', () => {
  it('rapprochent accents, casse, ponctuation, pluriel et une lettre d’écart', () => {
    expect(titleKey('Les Événements !')).toBe(titleKey('les evenement'));
    const pairs = duplicatePairs([
      { id: 'a', title: 'Serveur MCP' },
      { id: 'b', title: 'serveur-mcp' },
      { id: 'c', title: 'Persistance' },
      { id: 'd', title: 'Persistence' },
      { id: 'e', title: 'Kafka' },
      { id: 'f', title: 'Kafko' },
      { id: 'g', title: 'Élément 0.0.1' },
      { id: 'h', title: 'Élément 0.0.2' },
    ]);
    expect(pairs.map((pair) => pair.join('+')).toSorted()).toEqual([
      'a+b',
      'c+d',
    ]);
  });
});

describe('santé de la base', () => {
  it('liste chaque problème, avec des compteurs exacts et des listes plafonnées', () => {
    const { context } = workspace();
    const nodes = new NodeService(context);
    const documents = new DocumentService(context);
    const root = nodes.create({
      parentId: null,
      title: 'Racine',
      nodeType: 'concept',
    }).id;
    const leaf = nodes.create({
      parentId: root,
      title: 'Feuille',
      nodeType: 'concept',
    }).id;
    const linked = nodes.create({
      parentId: root,
      title: 'Reliée',
      nodeType: 'concept',
    }).id;
    const twin = nodes.create({
      parentId: null,
      title: 'racine',
      nodeType: 'concept',
    }).id;
    nodes.update({ id: root, summary: 'Résumé' });
    const doc = documents.create({
      nodeId: linked,
      title: 'Vide',
      contentType: 'markdown',
    }).id;
    const withLink = documents.create({
      nodeId: root,
      title: 'Liens',
      contentType: 'markdown',
    }).id;
    documents.update({ id: withLink, body: '[[Feuille]] [[Inconnu]]' });
    // [[Feuille]] relie Racine → Feuille : Feuille n'est plus isolée.
    const types = new RelationTypeService(context).list();
    new EdgeService(context).create({
      sourceId: linked,
      targetId: twin,
      relationTypeId: types[0]!.id,
    });

    const report = healthReport(context(), 1);
    const byId = Object.fromEntries(
      report.checks.map((check) => [check.id, check]),
    );
    expect(byId.noSummary!.count).toBe(3);
    expect(byId.noSummary!.issues).toHaveLength(1);
    expect(byId.emptyDocument!.issues[0]).toMatchObject({
      nodeId: linked,
      documentId: doc,
    });
    expect(byId.orphan!.count).toBe(0);
    expect(byId.brokenLink!.issues).toEqual([
      expect.objectContaining({
        nodeId: root,
        documentId: withLink,
        detail: 'Inconnu',
      }),
    ]);
    const duplicate = byId.duplicate!.issues[0]!;
    expect([duplicate.nodeId, duplicate.otherNodeId].toSorted()).toEqual(
      [root, twin].toSorted(),
    );
    expect(byId.assistantPending!.count).toBe(0);

    documents.update({ id: withLink, body: '' });
    expect(
      healthReport(context())
        .checks.find((check) => check.id === 'orphan')!
        .issues.map((item) => item.nodeId),
    ).toEqual([leaf]);
    expect(new AssistantChangeService(context).list()).toEqual([]);
  });
});

describe('sujets à documenter', () => {
  it('regroupent les requêtes, comptent, se traitent ou s’écartent', () => {
    const { context } = workspace();
    const ctx = context();
    recordSearchGap(ctx, 'Déploiement Kafka');
    recordSearchGap(ctx, '  deploiement   KAFKA ');
    recordSearchGap(ctx, 'Rollback');
    const open = listSearchGaps(ctx, 'open', 10);
    expect(open.map((gap) => [gap.query, gap.count])).toEqual([
      ['deploiement   KAFKA', 2],
      ['Rollback', 1],
    ]);
    setSearchGapStatus(ctx, open[0]!.key, 'done');
    setSearchGapStatus(ctx, open[1]!.key, 'ignored');
    expect(listSearchGaps(ctx, 'open', 10)).toEqual([]);
    expect(listSearchGaps(ctx, 'done', 10)).toHaveLength(1);
    expect(healthReport(ctx).gaps).toEqual([]);
  });

  it('restent en nombre borné', () => {
    const { context } = workspace();
    const ctx = context();
    for (let i = 0; i < SEARCH_GAP_LIMIT + 5; i++)
      recordSearchGap(ctx, `sujet ${i}`);
    expect(
      ctx.db.prepare('SELECT count(*) AS n FROM search_gap').get(),
    ).toEqual({ n: SEARCH_GAP_LIMIT });
  });
});
