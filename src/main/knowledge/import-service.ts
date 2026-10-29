/**
 * Import d'un export natif (§6.10) : validation préalable complète (schéma,
 * fichiers, empreintes), puis création d'un NOUVEL espace. Aucun espace
 * existant n'est modifié : une sauvegarde préalable n'est donc pas requise.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { CONTENT_TYPES, NODE_TYPES } from '../../shared/domain';
import { NodalError } from '../../shared/errors';
import { inTransaction } from '../database/transaction';
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION } from './export-service';

/** Au-delà, le rapport est tronqué. */
const MAX_REPORTED_ERRORS = 50;

const text = z.string();
const nullableText = z.string().nullable();
const iso = z.string().min(1);
const id = z.string().min(1).max(100);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable();

const documentSchema = z.object({
  id,
  title: z.string().min(1),
  contentType: z.enum(CONTENT_TYPES),
  language: nullableText,
  sortOrder: z.number().int(),
  createdAt: iso,
  updatedAt: iso,
  file: text,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const attachmentSchema = z.object({
  id,
  documentId: id.nullable(),
  fileName: z.string().min(1),
  mimeType: text,
  sizeBytes: z.number().int().min(0),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: iso,
  file: text,
});

const manifestSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.number().int().min(1),
  workspace: z.object({
    id,
    name: z.string().min(1),
    description: nullableText,
    createdAt: iso,
    updatedAt: iso,
  }),
  settings: z.record(z.string(), z.unknown()).optional(),
  relationTypes: z.array(
    z.object({ id, name: z.string().min(1), color, isBuiltin: z.boolean() }),
  ),
  tags: z.array(z.object({ id, name: z.string().min(1), color })),
  nodes: z.array(
    z.object({
      id,
      parentId: id.nullable(),
      title: z.string().min(1),
      nodeType: z.enum(NODE_TYPES),
      summary: nullableText,
      color,
      sortOrder: z.number().int(),
      position: z
        .object({ x: z.number(), y: z.number(), z: z.number().nullable() })
        .nullable(),
      tagIds: z.array(id),
      createdAt: iso,
      updatedAt: iso,
      documents: z.array(documentSchema),
      attachments: z.array(attachmentSchema),
    }),
  ),
  edges: z.array(
    z.object({
      id,
      sourceId: id,
      targetId: id,
      relationTypeId: id,
      label: nullableText,
      description: nullableText,
      createdAt: iso,
      updatedAt: iso,
    }),
  ),
});

export type ExportManifest = z.infer<typeof manifestSchema>;

export type ValidationResult =
  | { ok: true; manifest: ExportManifest; root: string }
  | { ok: false; errors: string[] };

const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

/**
 * Résout un chemin relatif du manifest en refusant toute sortie du dossier
 * d'export (chemins absolus, « .. »).
 */
export function resolveInside(root: string, relative: string): string | null {
  if (path.isAbsolute(relative) || relative.includes('\0')) return null;
  const resolved = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved.startsWith(prefix) ? resolved : null;
}

/** Valide un dossier d'export sans rien écrire. */
export function validateExportFolder(folder: string): ValidationResult {
  const root = path.resolve(folder);
  const errors: string[] = [];
  const fail = (message: string) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(message);
  };

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  } catch {
    return {
      ok: false,
      errors: [
        'Le dossier ne contient pas de manifest.json lisible : ce n’est pas un export Nodal.',
      ],
    };
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues
        .slice(0, MAX_REPORTED_ERRORS)
        .map(
          (issue) =>
            `manifest.json › ${issue.path.join('.') || '(racine)'} : ${issue.message}`,
        ),
    };
  }
  const manifest = parsed.data;
  if (manifest.formatVersion > EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `Export au format ${manifest.formatVersion}, plus récent que celui géré par cette version (${EXPORT_FORMAT_VERSION}). Mettez Nodal à jour.`,
      ],
    };
  }

  // Cohérence des références.
  const nodeIds = new Set<string>();
  const documentIds = new Set<string>();
  for (const node of manifest.nodes) {
    if (nodeIds.has(node.id)) fail(`Nœud en double : ${node.id}`);
    nodeIds.add(node.id);
    for (const doc of node.documents) {
      if (documentIds.has(doc.id)) fail(`Document en double : ${doc.id}`);
      documentIds.add(doc.id);
    }
  }
  const tagIds = new Set(manifest.tags.map((tag) => tag.id));
  const relationTypeIds = new Set(
    manifest.relationTypes.map((type) => type.id),
  );
  for (const node of manifest.nodes) {
    if (node.parentId !== null && !nodeIds.has(node.parentId)) {
      fail(`« ${node.title} » : parent introuvable (${node.parentId}).`);
    }
    for (const tagId of node.tagIds) {
      if (!tagIds.has(tagId))
        fail(`« ${node.title} » : tag introuvable (${tagId}).`);
    }
  }
  for (const edge of manifest.edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      fail(`Relation ${edge.id} : extrémité introuvable.`);
    }
    if (!relationTypeIds.has(edge.relationTypeId)) {
      fail(`Relation ${edge.id} : type de relation introuvable.`);
    }
  }
  // Cycles dans la hiérarchie.
  const parentOf = new Map(
    manifest.nodes.map((node) => [node.id, node.parentId]),
  );
  for (const node of manifest.nodes) {
    const seen = new Set<string>();
    let current: string | null = node.id;
    while (current !== null) {
      if (seen.has(current)) {
        fail(`Cycle dans la hiérarchie autour de « ${node.title} ».`);
        break;
      }
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  }

  // Fichiers : présence, confinement et empreintes.
  for (const node of manifest.nodes) {
    for (const doc of node.documents) {
      const file = resolveInside(root, doc.file);
      if (!file) {
        fail(
          `Document « ${doc.title} » : chemin de fichier refusé (${doc.file}).`,
        );
        continue;
      }
      try {
        const body = fs.readFileSync(file, 'utf8');
        if (sha256(body) !== doc.sha256) {
          fail(
            `Document « ${doc.title} » : contenu modifié ou corrompu (${doc.file}).`,
          );
        }
      } catch {
        fail(`Document « ${doc.title} » : fichier manquant (${doc.file}).`);
      }
    }
    for (const attachment of node.attachments) {
      if (
        attachment.documentId !== null &&
        !documentIds.has(attachment.documentId)
      ) {
        fail(`Pièce jointe « ${attachment.fileName} » : document introuvable.`);
      }
      const file = resolveInside(root, attachment.file);
      if (!file) {
        fail(
          `Pièce jointe « ${attachment.fileName} » : chemin refusé (${attachment.file}).`,
        );
        continue;
      }
      try {
        const data = fs.readFileSync(file);
        if (
          data.byteLength !== attachment.sizeBytes ||
          sha256(data) !== attachment.checksum
        ) {
          fail(
            `Pièce jointe « ${attachment.fileName} » : contenu modifié ou corrompu.`,
          );
        }
      } catch {
        fail(
          `Pièce jointe « ${attachment.fileName} » : fichier manquant (${attachment.file}).`,
        );
      }
    }
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, manifest, root };
}

/** Ordre d'insertion : chaque parent avant ses enfants. */
function parentsFirst<T extends { id: string; parentId: string | null }>(
  items: T[],
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const done = new Set<string>();
  const ordered: T[] = [];
  const visit = (item: T) => {
    if (done.has(item.id)) return;
    if (item.parentId) {
      const parent = byId.get(item.parentId);
      if (parent) visit(parent);
    }
    done.add(item.id);
    ordered.push(item);
  };
  for (const item of items) visit(item);
  return ordered;
}

/**
 * Écrit le contenu d'un export validé dans une base Nodal neuve (déjà migrée
 * et vide), en une seule transaction. Les identifiants sont conservés.
 */
export function writeImport(
  db: DatabaseSync,
  manifest: ExportManifest,
  root: string,
): { nodeCount: number; documentCount: number; attachmentCount: number } {
  const ws = manifest.workspace;
  let documentCount = 0;
  let attachmentCount = 0;
  inTransaction(db, () => {
    db.prepare(
      'INSERT INTO workspace (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(ws.id, ws.name, ws.description, ws.createdAt, ws.updatedAt);

    const insertSetting = db.prepare(
      'INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)',
    );
    const maxSize = manifest.settings?.attachmentMaxSizeBytes;
    if (typeof maxSize === 'number') {
      insertSetting.run(ws.id, 'attachment.maxSizeBytes', String(maxSize));
    }

    const insertType = db.prepare(
      'INSERT INTO relation_type (id, workspace_id, name, color, is_builtin) VALUES (?, ?, ?, ?, ?)',
    );
    for (const type of manifest.relationTypes) {
      insertType.run(
        type.id,
        ws.id,
        type.name,
        type.color,
        type.isBuiltin ? 1 : 0,
      );
    }
    const insertTag = db.prepare(
      'INSERT INTO tag (id, workspace_id, name, color) VALUES (?, ?, ?, ?)',
    );
    for (const tag of manifest.tags)
      insertTag.run(tag.id, ws.id, tag.name, tag.color);

    const insertNode = db.prepare(
      `INSERT INTO node (id, workspace_id, parent_id, title, node_type, summary, color,
         position_x, position_y, position_z, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertNodeTag = db.prepare(
      'INSERT INTO node_tag (node_id, tag_id) VALUES (?, ?)',
    );
    const insertDocument = db.prepare(
      `INSERT INTO document (id, node_id, title, content_type, language, body, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAttachment = db.prepare(
      `INSERT INTO attachment (id, node_id, document_id, file_name, data, mime_type, size_bytes, checksum, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const nodes = parentsFirst(manifest.nodes);
    for (const node of nodes) {
      insertNode.run(
        node.id,
        ws.id,
        node.parentId,
        node.title,
        node.nodeType,
        node.summary,
        node.color,
        node.position?.x ?? null,
        node.position?.y ?? null,
        node.position?.z ?? null,
        node.sortOrder,
        node.createdAt,
        node.updatedAt,
      );
      for (const tagId of new Set(node.tagIds))
        insertNodeTag.run(node.id, tagId);
    }
    // Documents puis pièces jointes (une pièce jointe peut viser un document).
    for (const node of nodes) {
      for (const doc of node.documents) {
        const body = fs.readFileSync(resolveInside(root, doc.file)!, 'utf8');
        insertDocument.run(
          doc.id,
          node.id,
          doc.title,
          doc.contentType,
          doc.contentType === 'code' ? doc.language : null,
          body,
          doc.sortOrder,
          doc.createdAt,
          doc.updatedAt,
        );
        documentCount++;
      }
    }
    for (const node of nodes) {
      for (const attachment of node.attachments) {
        const data = fs.readFileSync(resolveInside(root, attachment.file)!);
        insertAttachment.run(
          attachment.id,
          attachment.documentId ? null : node.id,
          attachment.documentId,
          attachment.fileName,
          data,
          attachment.mimeType,
          data.byteLength,
          attachment.checksum,
          attachment.createdAt,
        );
        attachmentCount++;
      }
    }

    const insertEdge = db.prepare(
      `INSERT INTO edge (id, workspace_id, source_node_id, target_node_id, relation_type_id, label, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const edge of manifest.edges) {
      insertEdge.run(
        edge.id,
        ws.id,
        edge.sourceId,
        edge.targetId,
        edge.relationTypeId,
        edge.label,
        edge.description,
        edge.createdAt,
        edge.updatedAt,
      );
    }
  });
  return { nodeCount: manifest.nodes.length, documentCount, attachmentCount };
}

/** Message d'erreur lisible pour un import qui échoue après validation. */
export function importFailure(cause: unknown): NodalError {
  return new NodalError(
    'IO_ERROR',
    'L’import a échoué pendant l’écriture du nouvel espace ; aucun fichier n’a été conservé.',
    { cause },
  );
}
