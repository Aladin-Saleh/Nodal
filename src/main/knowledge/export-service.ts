/**
 * Export natif portable d'un espace (§6.10, §13) : un dossier contenant un
 * manifest.json versionné, les documents dans leur format source et les
 * pièces jointes. L'export ne dépend ni de l'interface ni de SQLite.
 *
 * TODO(perf) : écriture synchrone sur le thread principal ; à déplacer dans
 * un utilityProcess si de gros espaces rendent l'export perceptible.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ContentType, NodeType } from '../../shared/domain';
import type { WorkspaceInfo } from '../../shared/ipc-contract';
import type { ExportResult } from '../../shared/model';
import type { ServiceContext } from './context';
import { listEdges } from './edge-service';
import { listRelationTypes } from './relation-type-service';
import { asRows } from './rows';
import { readSettings } from './settings-service';

export const EXPORT_FORMAT = 'nodal-export';
export const EXPORT_FORMAT_VERSION = 1;

const CODE_EXTENSIONS: Record<string, string> = {
  java: 'java',
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  sql: 'sql',
  go: 'go',
  json: 'json',
  yaml: 'yaml',
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
};

/** Extension du fichier source d'un document selon son type. */
export function documentExtension(
  contentType: ContentType,
  language: string | null,
): string {
  switch (contentType) {
    case 'markdown':
      return 'md';
    case 'text':
      return 'txt';
    case 'json':
      return 'json';
    case 'mermaid':
      return 'mmd';
    case 'code':
      return (language && CODE_EXTENSIONS[language]) ?? 'txt';
  }
}

/** Nom de fichier sûr sous Windows (caractères interdits, noms réservés). */
export function safeFileName(name: string, fallback: string): string {
  // oxlint-disable-next-line no-control-regex
  let cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  cleaned = cleaned.replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cleaned)) {
    cleaned = `_${cleaned}`;
  }
  return (cleaned || fallback).slice(0, 120);
}

function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function timestampForPath(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

interface NodeRow {
  id: string;
  parent_id: string | null;
  title: string;
  node_type: NodeType;
  summary: string | null;
  color: string | null;
  position_x: number | null;
  position_y: number | null;
  position_z: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface DocumentRow {
  id: string;
  node_id: string;
  title: string;
  content_type: ContentType;
  language: string | null;
  body: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface AttachmentRow {
  id: string;
  node_id: string | null;
  document_id: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  created_at: string;
  data: Uint8Array;
}

const README = `Export Nodal
============

Ce dossier est un export portable d'un espace de connaissances Nodal.

- manifest.json : structure complète (espace, nœuds, hiérarchie, relations,
  types de relations, tags, métadonnées des documents et pièces jointes).
  Le champ "formatVersion" indique la version du format.
- documents/ : un fichier par document, dans son format source
  (.md Markdown, .txt texte, .json JSON, .mmd Mermaid, extension du langage
  pour le code). Le contenu est copié à l'identique.
- attachments/<identifiant>/ : les pièces jointes, avec leur nom d'origine.

Chaque fichier est référencé dans manifest.json par son chemin relatif et
son empreinte SHA-256.
`;

/**
 * Exporte l'espace courant dans un nouveau sous-dossier de `parentDir`.
 * L'écriture se fait dans un dossier temporaire renommé à la fin : un export
 * interrompu ne laisse pas de dossier incomplet à son nom définitif.
 */
export function exportWorkspace(
  ctx: ServiceContext,
  workspace: WorkspaceInfo,
  parentDir: string,
  generator: { name: string; version: string },
): ExportResult {
  const exportedAt = ctx.now();
  const baseName = `${safeFileName(workspace.name, 'espace')}-export-${timestampForPath(exportedAt)}`;
  let folderPath = path.join(parentDir, baseName);
  for (let i = 2; fs.existsSync(folderPath); i++) {
    folderPath = path.join(parentDir, `${baseName}-${i}`);
  }
  const partial = `${folderPath}.partial`;
  fs.rmSync(partial, { recursive: true, force: true });

  const { db, workspaceId } = ctx;
  const nodes = asRows<NodeRow>(
    db
      .prepare(
        `SELECT id, parent_id, title, node_type, summary, color, position_x, position_y, position_z,
           sort_order, created_at, updated_at
         FROM node WHERE workspace_id = ? ORDER BY sort_order, rowid`,
      )
      .all(workspaceId),
  );
  const documents = asRows<DocumentRow>(
    db
      .prepare(
        `SELECT d.id, d.node_id, d.title, d.content_type, d.language, d.body, d.sort_order,
           d.created_at, d.updated_at
         FROM document d JOIN node n ON n.id = d.node_id
         WHERE n.workspace_id = ? ORDER BY d.sort_order, d.rowid`,
      )
      .all(workspaceId),
  );
  const tags = asRows<{ id: string; name: string; color: string | null }>(
    db
      .prepare(
        'SELECT id, name, color FROM tag WHERE workspace_id = ? ORDER BY name',
      )
      .all(workspaceId),
  );
  const nodeTags = asRows<{ node_id: string; tag_id: string }>(
    db
      .prepare(
        `SELECT nt.node_id, nt.tag_id FROM node_tag nt
         JOIN node n ON n.id = nt.node_id WHERE n.workspace_id = ?`,
      )
      .all(workspaceId),
  );

  const write = (relative: string, data: string | Uint8Array) => {
    const target = path.join(partial, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  };

  try {
    fs.mkdirSync(partial, { recursive: true });
    const documentsByNode = new Map<string, unknown[]>();
    for (const doc of documents) {
      const file = `documents/${doc.id}.${documentExtension(doc.content_type, doc.language)}`;
      write(file, doc.body);
      const list = documentsByNode.get(doc.node_id) ?? [];
      list.push({
        id: doc.id,
        title: doc.title,
        contentType: doc.content_type,
        language: doc.language,
        sortOrder: doc.sort_order,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        file,
        sha256: sha256(doc.body),
      });
      documentsByNode.set(doc.node_id, list);
    }

    // Pièces jointes lues une à une : jamais toutes en mémoire.
    const attachmentsByNode = new Map<string, unknown[]>();
    let attachmentCount = 0;
    const attachmentStatement = db.prepare(
      `SELECT a.id, a.node_id, a.document_id, a.file_name, a.mime_type, a.size_bytes,
         a.checksum, a.created_at, a.data
       FROM attachment a
       LEFT JOIN document d ON d.id = a.document_id
       JOIN node n ON n.id = COALESCE(a.node_id, d.node_id)
       WHERE n.workspace_id = ?`,
    );
    for (const raw of attachmentStatement.iterate(workspaceId)) {
      const attachment = raw as unknown as AttachmentRow;
      const ownerNodeId =
        attachment.node_id ??
        documents.find((doc) => doc.id === attachment.document_id)?.node_id;
      if (!ownerNodeId) continue;
      const file = `attachments/${attachment.id}/${safeFileName(attachment.file_name, 'fichier')}`;
      write(file, attachment.data);
      attachmentCount++;
      const list = attachmentsByNode.get(ownerNodeId) ?? [];
      list.push({
        id: attachment.id,
        documentId: attachment.document_id,
        fileName: attachment.file_name,
        mimeType: attachment.mime_type,
        sizeBytes: attachment.size_bytes,
        checksum: attachment.checksum,
        createdAt: attachment.created_at,
        file,
      });
      attachmentsByNode.set(ownerNodeId, list);
    }

    const tagsByNode = new Map<string, string[]>();
    for (const { node_id, tag_id } of nodeTags) {
      tagsByNode.set(node_id, [...(tagsByNode.get(node_id) ?? []), tag_id]);
    }

    const manifest = {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt,
      generator,
      schemaVersion: workspace.schemaVersion,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
      settings: readSettings(ctx),
      relationTypes: listRelationTypes(ctx).map(
        ({ id, name, color, isBuiltin }) => ({ id, name, color, isBuiltin }),
      ),
      tags,
      nodes: nodes.map((node) => ({
        id: node.id,
        parentId: node.parent_id,
        title: node.title,
        nodeType: node.node_type,
        summary: node.summary,
        color: node.color,
        sortOrder: node.sort_order,
        position:
          node.position_x === null || node.position_y === null
            ? null
            : { x: node.position_x, y: node.position_y, z: node.position_z },
        tagIds: tagsByNode.get(node.id) ?? [],
        createdAt: node.created_at,
        updatedAt: node.updated_at,
        documents: documentsByNode.get(node.id) ?? [],
        attachments: attachmentsByNode.get(node.id) ?? [],
      })),
      edges: listEdges(ctx),
    };
    write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
    write('LISEZMOI.txt', README);
    fs.renameSync(partial, folderPath);

    return {
      folderPath,
      nodeCount: nodes.length,
      documentCount: documents.length,
      attachmentCount,
    };
  } catch (error) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw error;
  }
}
