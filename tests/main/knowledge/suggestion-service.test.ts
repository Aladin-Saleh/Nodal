import { describe, expect, it } from 'vitest';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { EdgeService } from '../../../src/main/knowledge/edge-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { SuggestionService } from '../../../src/main/knowledge/suggestion-service';
import {
  findTitleMention,
  mentionIndex,
  suggestibleTitle,
} from '../../../src/shared/link-suggestions';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

const mention = (body: string, title: string) => {
  const folded = suggestibleTitle(title);
  return folded ? findTitleMention(mentionIndex(body), folded) : null;
};

describe('détection d’un titre cité', () => {
  it('mot entier, sans accents ni casse, espaces souples', () => {
    expect(mention('On lit la file KAFKA ici.', 'Kafka')).toEqual({
      start: 15,
      end: 20,
    });
    expect(mention('Le Kafkaïen bus', 'Kafka')).toBeNull();
    expect(
      mention('Le cache  distribué\nsert', 'Cache distribue'),
    ).not.toBeNull();
    expect(mention('Cache distribuée', 'Cache distribue')).toBeNull();
  });

  it('ignore le code, les liens existants, les titres courts ou génériques', () => {
    expect(mention('`Kafka` et\n```\nKafka\n```', 'Kafka')).toBeNull();
    expect(mention('Voir [[Kafka]].', 'Kafka')).toBeNull();
    expect(suggestibleTitle('API')).toBeNull();
    expect(suggestibleTitle('Notes')).toBeNull();
    expect(suggestibleTitle('Données')).toBeNull();
    expect(suggestibleTitle('2024')).toBeNull();
    expect(suggestibleTitle('Redis')).toBe('redis');
  });
});

function setup() {
  const { context } = workspace();
  const nodes = new NodeService(context);
  const documents = new DocumentService(context);
  const node = (title: string, parentId: string | null = null) =>
    nodes.create({ parentId, title, nodeType: 'concept' }).id;
  const api = node('Service commandes');
  const child = node('Cache local', api);
  const kafka = node('Kafka');
  const redis = node('Redis');
  node('Notes');
  const doc = documents.create({
    nodeId: api,
    title: 'Fonctionnement',
    contentType: 'markdown',
  }).id;
  documents.update({
    id: doc,
    body: 'Publie dans kafka, garde un Cache local et lit redis. Voir les notes.',
  });
  const suggestions = new SuggestionService(context);
  const targets = () =>
    suggestions.listForNode(api).map((suggestion) => suggestion.targetTitle);
  return {
    context,
    api,
    child,
    kafka,
    redis,
    doc,
    documents,
    suggestions,
    targets,
  };
}

describe('suggestions de liens', () => {
  it('proposent les nœuds cités, pas le parent/enfant ni les titres génériques', () => {
    const { suggestions, api, targets } = setup();
    expect(targets()).toEqual(['Kafka', 'Redis']);
    const [first] = suggestions.listForNode(api);
    expect(first).toMatchObject({ documentTitle: 'Fonctionnement' });
    expect(first!.snippet).toContain('Publie dans kafka');
  });

  it('montrent un extrait qui ne coupe pas un lien, liens lisibles', () => {
    const { suggestions, api, doc, documents, redis } = setup();
    const filler = 'x'.repeat(30);
    documents.update({
      id: doc,
      body: `${filler} [[node:${redis}]] ${filler} kafka.`,
    });
    const [kafka] = suggestions.listForNode(api);
    expect(kafka!.snippet).toBe(`…[[Redis]] ${filler} kafka.`);
  });

  it('disparaissent une fois les nœuds reliés (dans un sens ou l’autre)', () => {
    const { context, suggestions, api, kafka, redis, targets } = setup();
    suggestions.accept({ sourceId: api, targetId: kafka, mode: 'relation' });
    const edges = new EdgeService(context);
    expect(
      edges
        .listForNode(api)
        .map((edge) => [edge.otherNodeTitle, edge.fromLink ?? false]),
    ).toEqual([['Kafka', false]]);
    // Relation entrante créée à la main : plus de suggestion non plus.
    edges.create({
      sourceId: redis,
      targetId: api,
      relationTypeId: edges.listForNode(api)[0]!.relationTypeId,
    });
    expect(targets()).toEqual([]);
  });

  it('convertissent la mention en lien [[...]], qui crée sa relation', () => {
    const { context, suggestions, api, kafka, doc, documents, targets } =
      setup();
    suggestions.accept({ sourceId: api, targetId: kafka, mode: 'link' });
    expect(documents.get(doc).body).toBe(
      `Publie dans [[node:${kafka}|kafka]], garde un Cache local et lit redis. Voir les notes.`,
    );
    expect(
      new EdgeService(context).listForNode(api).map((edge) => edge.fromLink),
    ).toEqual([true]);
    expect(targets()).toEqual(['Redis']);
  });

  it('mémorisent un refus ; refusent une suggestion périmée', () => {
    const { suggestions, api, redis, kafka, doc, documents, targets } = setup();
    suggestions.ignore({ sourceId: api, targetId: redis });
    suggestions.ignore({ sourceId: api, targetId: redis });
    expect(targets()).toEqual(['Kafka']);
    documents.update({ id: doc, body: 'Plus rien.' });
    expect(() =>
      suggestions.accept({ sourceId: api, targetId: kafka, mode: 'link' }),
    ).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('oublient le refus avec le nœud supprimé', () => {
    const { context, suggestions, api, redis } = setup();
    suggestions.ignore({ sourceId: api, targetId: redis });
    new NodeService(context).delete({
      id: redis,
      childrenStrategy: 'reparent',
    });
    expect(
      context()
        .db.prepare('SELECT count(*) AS n FROM link_suggestion_ignored')
        .get(),
    ).toEqual({ n: 0 });
  });
});
