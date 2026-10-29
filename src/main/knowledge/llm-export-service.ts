/**
 * Export orienté LLM (§6.7) : données structurées du graphe en TOON (avec un
 * JSON équivalent d'interopérabilité), documents dans leur format source et
 * fragments dérivés (chunks.jsonl). Les sources ne sont jamais modifiées.
 *
 * Le comptage des tokens est fait par un tokenizer explicitement identifié
 * dans le manifest ; aucun nombre de caractères n'est présenté comme un
 * nombre de tokens.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encode as encodeToon } from '@toon-format/toon';
import type { ContentType, NodeType } from '../../shared/domain';
import type { WorkspaceInfo } from '../../shared/ipc-contract';
import type {
  LlmExportOptions,
  LlmExportResult,
  LlmExportScope,
} from '../../shared/model';
import { NodalError } from '../../shared/errors';
import {
  CHUNK_STRATEGY_VERSION,
  chunkDocument,
  type TokenCounter,
} from './chunking';
import type { ServiceContext } from './context';
import {
  documentExtension,
  safeFileName,
  timestampForPath,
} from './export-service';
import { asRows } from './rows';

export const LLM_EXPORT_FORMAT = 'nodal-llm-export';
export const LLM_EXPORT_SCHEMA_VERSION = 1;

export interface TokenizerInfo {
  name: string;
  version: string;
  encoding: string;
  /** Modèle cible, si le comptage vise un modèle précis. */
  targetModel: string | null;
}

export interface Tokenizer {
  info: TokenizerInfo;
  count: TokenCounter;
}

/** Version installée de js-tiktoken (vérifiée par un test). */
export const TIKTOKEN_VERSION = '1.0.21';

/** Tokenizer o200k_base, chargé à la demande (le dictionnaire est volumineux). */
export async function createDefaultTokenizer(): Promise<Tokenizer> {
  const [{ Tiktoken }, ranks] = await Promise.all([
    import('js-tiktoken/lite'),
    import('js-tiktoken/ranks/o200k_base'),
  ]);
  const encoder = new Tiktoken(ranks.default);
  return {
    info: {
      name: 'js-tiktoken',
      version: TIKTOKEN_VERSION,
      encoding: 'o200k_base',
      targetModel: null,
    },
    count: (text) => encoder.encode(text).length,
  };
}

interface NodeRow {
  id: string;
  parent_id: string | null;
  title: string;
  node_type: NodeType;
  summary: string | null;
}

interface DocumentRow {
  id: string;
  node_id: string;
  title: string;
  content_type: ContentType;
  language: string | null;
  body: string;
}

interface EdgeRow {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type_id: string;
  label: string | null;
}

const sha256 = (text: string) =>
  createHash('sha256').update(text).digest('hex');

/** Nœuds couverts par la portée choisie (§6.7 : espace, sous-arbre, voisinage). */
export function selectScope(
  nodes: readonly NodeRow[],
  edges: readonly EdgeRow[],
  scope: LlmExportScope,
): Set<string> {
  if (scope.kind === 'workspace') return new Set(nodes.map((node) => node.id));
  if (!nodes.some((node) => node.id === scope.nodeId)) {
    throw new NodalError('NOT_FOUND', 'Nœud de départ introuvable.');
  }
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parent_id) {
      children.set(node.parent_id, [
        ...(children.get(node.parent_id) ?? []),
        node.id,
      ]);
    }
  }
  if (scope.kind === 'subtree') {
    const result = new Set<string>();
    const stack = [scope.nodeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (result.has(id)) continue;
      result.add(id);
      stack.push(...(children.get(id) ?? []));
    }
    return result;
  }
  // Voisinage : relations dans les deux sens et liens parent-enfant.
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) =>
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
  for (const edge of edges) {
    link(edge.source_node_id, edge.target_node_id);
    link(edge.target_node_id, edge.source_node_id);
  }
  for (const node of nodes) {
    if (node.parent_id) {
      link(node.id, node.parent_id);
      link(node.parent_id, node.id);
    }
  }
  const result = new Set([scope.nodeId]);
  let frontier = [scope.nodeId];
  for (let level = 0; level < scope.depth; level++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!result.has(neighbor)) {
          result.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return result;
}

export interface LlmChunk {
  chunkId: string;
  chunkIndex: number;
  sourceNodeId: string;
  sourceDocumentId: string | null;
  contentType: ContentType | 'node';
  language: string | null;
  hierarchyPath: string;
  section: string | null;
  relatedNodeIds: string[];
  tokenCount: number;
  contentSha256: string;
  content: string;
}

export interface LlmExportData {
  graph: Record<string, unknown>;
  chunks: LlmChunk[];
  documents: { id: string; file: string; body: string }[];
}

/** Construit le contenu de l'export (sans écrire sur le disque). */
export function buildLlmExport(
  ctx: ServiceContext,
  workspace: Pick<WorkspaceInfo, 'id' | 'name'>,
  options: LlmExportOptions,
  tokenizer: Tokenizer,
): LlmExportData {
  const { db, workspaceId } = ctx;
  const allNodes = asRows<NodeRow>(
    db
      .prepare(
        'SELECT id, parent_id, title, node_type, summary FROM node WHERE workspace_id = ? ORDER BY sort_order, rowid',
      )
      .all(workspaceId),
  );
  const allEdges = asRows<EdgeRow>(
    db
      .prepare(
        'SELECT id, source_node_id, target_node_id, relation_type_id, label FROM edge WHERE workspace_id = ? ORDER BY rowid',
      )
      .all(workspaceId),
  );
  const inScope = selectScope(allNodes, allEdges, options.scope);
  const nodes = allNodes.filter((node) => inScope.has(node.id));
  const edges = allEdges.filter(
    (edge) =>
      inScope.has(edge.source_node_id) && inScope.has(edge.target_node_id),
  );
  const relationTypes = asRows<{ id: string; name: string }>(
    db
      .prepare(
        'SELECT id, name FROM relation_type WHERE workspace_id = ? ORDER BY rowid',
      )
      .all(workspaceId),
  );
  const typeName = new Map(relationTypes.map((type) => [type.id, type.name]));
  const tags = asRows<{ id: string; name: string }>(
    db
      .prepare('SELECT id, name FROM tag WHERE workspace_id = ? ORDER BY name')
      .all(workspaceId),
  );
  const nodeTags = asRows<{ node_id: string; tag_id: string }>(
    db
      .prepare(
        'SELECT nt.node_id, nt.tag_id FROM node_tag nt JOIN node n ON n.id = nt.node_id WHERE n.workspace_id = ?',
      )
      .all(workspaceId),
  ).filter((row) => inScope.has(row.node_id));
  const documents = asRows<DocumentRow>(
    db
      .prepare(
        `SELECT d.id, d.node_id, d.title, d.content_type, d.language, d.body
         FROM document d JOIN node n ON n.id = d.node_id
         WHERE n.workspace_id = ? ORDER BY d.sort_order, d.rowid`,
      )
      .all(workspaceId),
  ).filter((doc) => inScope.has(doc.node_id));

  // Chemins hiérarchiques complets (y compris les ancêtres hors portée).
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const pathOf = (id: string): string => {
    const titles: string[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      titles.unshift(current.title);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return titles.join(' > ');
  };
  const related = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const [a, b] of [
      [edge.source_node_id, edge.target_node_id],
      [edge.target_node_id, edge.source_node_id],
    ] as const) {
      related.set(a, (related.get(a) ?? new Set()).add(b));
    }
  }

  const chunks: LlmChunk[] = [];
  const pushChunk = (
    base: Omit<
      LlmChunk,
      'chunkId' | 'chunkIndex' | 'tokenCount' | 'contentSha256'
    >,
    index: number,
  ) => {
    const contentSha256 = sha256(base.content);
    chunks.push({
      ...base,
      chunkIndex: index,
      // Identifiant reproductible : même source, même découpage → même id.
      chunkId: sha256(
        `${CHUNK_STRATEGY_VERSION}|${base.sourceDocumentId ?? base.sourceNodeId}|${index}|${contentSha256}`,
      ).slice(0, 24),
      tokenCount: tokenizer.count(base.content),
      contentSha256,
    });
  };

  const documentEntries: Record<string, unknown>[] = [];
  const documentFiles: LlmExportData['documents'] = [];
  for (const node of nodes) {
    const hierarchyPath = pathOf(node.id);
    const relatedNodeIds = [...(related.get(node.id) ?? [])];
    pushChunk(
      {
        sourceNodeId: node.id,
        sourceDocumentId: null,
        contentType: 'node',
        language: null,
        hierarchyPath,
        section: null,
        relatedNodeIds,
        content: [
          `${node.title} (${node.node_type})`,
          `Chemin : ${hierarchyPath}`,
          node.summary ? `Résumé : ${node.summary}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      },
      0,
    );
    for (const doc of documents.filter(
      (candidate) => candidate.node_id === node.id,
    )) {
      const pieces = chunkDocument(
        doc.body,
        doc.content_type,
        doc.language,
        options.maxTokens,
        tokenizer.count,
      );
      pieces.forEach((piece, index) =>
        pushChunk(
          {
            sourceNodeId: node.id,
            sourceDocumentId: doc.id,
            contentType: doc.content_type,
            language: doc.language,
            hierarchyPath: `${hierarchyPath} > ${doc.title}`,
            section: piece.section,
            relatedNodeIds,
            content: piece.content,
          },
          index,
        ),
      );
      const file = `documents/${doc.id}.${documentExtension(doc.content_type, doc.language)}`;
      documentFiles.push({ id: doc.id, file, body: doc.body });
      documentEntries.push({
        id: doc.id,
        nodeId: node.id,
        title: doc.title,
        contentType: doc.content_type,
        language: doc.language,
        file,
        tokenCount: tokenizer.count(doc.body),
        chunkCount: pieces.length,
      });
    }
  }

  const graph = {
    exportSchemaVersion: LLM_EXPORT_SCHEMA_VERSION,
    workspace: { id: workspace.id, name: workspace.name },
    relationTypes,
    tags,
    nodes: nodes.map((node) => ({
      id: node.id,
      title: node.title,
      type: node.node_type,
      parentId: node.parent_id,
      path: pathOf(node.id),
      summary: node.summary,
    })),
    nodeTags: nodeTags.map((row) => ({
      nodeId: row.node_id,
      tagId: row.tag_id,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sourceId: edge.source_node_id,
      targetId: edge.target_node_id,
      relation: typeName.get(edge.relation_type_id) ?? null,
      label: edge.label,
    })),
    documents: documentEntries,
  };
  return { graph, chunks, documents: documentFiles };
}

const README = `Export Nodal pour LLM
=====================

- graph.toon : données structurées du graphe (nœuds, chemins hiérarchiques,
  relations, types, tags, liste des documents) au format TOON
  (Token-Oriented Object Notation).
- graph.json : exactement les mêmes données, en JSON (interopérabilité).
- documents/ : chaque document dans son format source, inchangé.
- chunks.jsonl : fragments dérivés, une ligne JSON par fragment, avec
  identifiant reproductible, nœud et document sources, chemin
  hiérarchique, nœuds liés, ordre et nombre de tokens.
- manifest.json : version du schéma d'export, portée, tokenizer utilisé
  (nom, version, encodage) et version de la stratégie de découpage.

Les fragments sont régénérables : ils ne remplacent jamais les documents.
`;

/** Écrit l'export dans un nouveau sous-dossier de \`parentDir\` (écriture atomique). */
export function writeLlmExport(
  ctx: ServiceContext,
  workspace: WorkspaceInfo,
  parentDir: string,
  options: LlmExportOptions,
  tokenizer: Tokenizer,
  generator: { name: string; version: string },
): LlmExportResult {
  const exportedAt = ctx.now();
  const data = buildLlmExport(ctx, workspace, options, tokenizer);
  const baseName = `${safeFileName(workspace.name, 'espace')}-llm-${timestampForPath(exportedAt)}`;
  let folderPath = path.join(parentDir, baseName);
  for (let i = 2; fs.existsSync(folderPath); i++) {
    folderPath = path.join(parentDir, `${baseName}-${i}`);
  }
  const partial = `${folderPath}.partial`;
  fs.rmSync(partial, { recursive: true, force: true });
  const write = (relative: string, content: string) => {
    const target = path.join(partial, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  try {
    write('graph.toon', `${encodeToon(data.graph)}\n`);
    write('graph.json', `${JSON.stringify(data.graph, null, 2)}\n`);
    write(
      'chunks.jsonl',
      data.chunks.map((chunk) => JSON.stringify(chunk)).join('\n') +
        (data.chunks.length ? '\n' : ''),
    );
    for (const doc of data.documents) write(doc.file, doc.body);
    const totalTokens = data.chunks.reduce(
      (sum, chunk) => sum + chunk.tokenCount,
      0,
    );
    write(
      'manifest.json',
      `${JSON.stringify(
        {
          format: LLM_EXPORT_FORMAT,
          exportSchemaVersion: LLM_EXPORT_SCHEMA_VERSION,
          exportedAt,
          generator,
          workspace: { id: workspace.id, name: workspace.name },
          scope: options.scope,
          tokenizer: tokenizer.info,
          chunkStrategy: {
            name: 'structure-aware',
            version: CHUNK_STRATEGY_VERSION,
            maxTokens: options.maxTokens,
          },
          files: {
            graphToon: 'graph.toon',
            graphJson: 'graph.json',
            chunks: 'chunks.jsonl',
            documents: 'documents/',
          },
          stats: {
            nodeCount: (data.graph.nodes as unknown[]).length,
            edgeCount: (data.graph.edges as unknown[]).length,
            documentCount: data.documents.length,
            chunkCount: data.chunks.length,
            chunkTokens: totalTokens,
          },
        },
        null,
        2,
      )}\n`,
    );
    write('LISEZMOI.txt', README);
    fs.renameSync(partial, folderPath);
  } catch (error) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw error;
  }
  return {
    folderPath,
    nodeCount: (data.graph.nodes as unknown[]).length,
    documentCount: data.documents.length,
    chunkCount: data.chunks.length,
    tokenizer: `${tokenizer.info.name} ${tokenizer.info.version} (${tokenizer.info.encoding})`,
  };
}
