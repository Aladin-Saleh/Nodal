/**
 * Écritures d'un assistant IA dans l'espace (serveur MCP). Elles passent par
 * les services métier de l'application (mêmes règles, index de recherche tenu
 * à jour par les triggers) et chacune est tracée dans le journal
 * `assistant_change`, dans la même transaction, pour être relue et annulée
 * depuis Nodal. Aucune suppression n'est proposée.
 */
import type { z } from 'zod';
import type { ContentType, NodeType } from '../shared/domain';
import { NodalError } from '../shared/errors';
import {
  contentTypeSchema,
  languageSchema,
  nodeTitleSchema,
  relationTypeNameSchema,
  tagNameSchema,
  updateDocumentInputSchema,
  updateNodeInputSchema,
  createEdgeInputSchema,
} from '../shared/ipc-schemas';
import {
  readDocumentState,
  readNodeState,
  recordAssistantChange,
  type NodeState,
} from '../main/knowledge/assistant-change-service';
import { notFound } from '../main/knowledge/context';
import { DocumentService } from '../main/knowledge/document-service';
import { EdgeService } from '../main/knowledge/edge-service';
import { NodeService } from '../main/knowledge/node-service';
import { RelationTypeService } from '../main/knowledge/relation-type-service';
import { asRow, asRows } from '../main/knowledge/rows';
import { listNodeTags } from '../main/knowledge/tag-service';
import { TagService } from '../main/knowledge/tag-service';
import type { ReadContext } from './workspace-reader';

/** Contexte d'une écriture : l'espace et le nom de l'assistant appelant. */
export interface WriteContext extends ReadContext {
  client: string | null;
}

/** Valide une valeur avec les règles de l'application (mêmes messages). */
function check<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new NodalError(
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Valeur invalide.',
    );
  }
  return parsed.data;
}

/** Chemin hiérarchique « Racine > … > Nœud ». */
function pathOf(ctx: ReadContext, id: string): string {
  const rows = asRows<{ title: string }>(
    ctx.db
      .prepare(
        `WITH RECURSIVE anc(id, parent_id, title, depth) AS (
           SELECT id, parent_id, title, 0 FROM node WHERE id = ?
           UNION
           SELECT n.id, n.parent_id, n.title, anc.depth + 1
           FROM node n JOIN anc ON n.id = anc.parent_id WHERE anc.depth < 1000
         )
         SELECT title FROM anc ORDER BY depth DESC`,
      )
      .all(id),
  );
  return rows.map((row) => row.title).join(' > ');
}

const quoted = (text: string) => `« ${text} »`;

/** Tags de l'espace par nom (insensible à la casse), créés si besoin. */
function resolveTags(ctx: WriteContext, names: string[]): string[] {
  const tags = new TagService(() => ctx);
  const byName = new Map(
    tags.list().map((tag) => [tag.name.toLowerCase(), tag.id]),
  );
  return names.map((raw) => {
    const name = check(tagNameSchema, raw);
    const known = byName.get(name.toLowerCase());
    if (known) return known;
    const created = tags.create({ name });
    byName.set(name.toLowerCase(), created.id);
    return created.id;
  });
}

function nodeType(ctx: ReadContext, id: string): NodeType {
  const state = readNodeState(ctx, id);
  if (!state) throw notFound('Nœud');
  return state.nodeType;
}

export function createNode(
  ctx: WriteContext,
  input: {
    title: string;
    type: NodeType;
    parentId?: string | null;
    summary?: string;
    tags?: string[];
    allowDuplicate?: boolean;
  },
) {
  const title = check(nodeTitleSchema, input.title);
  const parentId = input.parentId ?? null;
  if (parentId) nodeType(ctx, parentId);
  // Évite les doublons : l'assistant doit compléter le nœud existant.
  const twin = asRow<{ id: string }>(
    ctx.db
      .prepare(
        `SELECT id FROM node WHERE workspace_id = ? AND parent_id IS ?
         AND title = ? COLLATE NOCASE LIMIT 1`,
      )
      .get(ctx.workspaceId, parentId, title),
  );
  if (twin && !input.allowDuplicate) {
    throw new NodalError(
      'CONFLICT',
      `Un nœud ${quoted(title)} existe déjà à cet endroit (id ${twin.id}). ` +
        'Complétez-le avec nodal_update_node / nodal_add_document, ou passez allowDuplicate: true.',
    );
  }
  const nodes = new NodeService(() => ctx);
  const { id } = nodes.create({ parentId, title, nodeType: input.type });
  if (input.summary !== undefined) {
    const { summary } = check(updateNodeInputSchema, {
      id,
      summary: input.summary,
    });
    nodes.update({ id, summary });
  }
  if (input.tags?.length) {
    nodes.setTags({ id, tagIds: resolveTags(ctx, input.tags) });
  }
  const path = pathOf(ctx, id);
  recordAssistantChange(ctx, {
    action: 'create_node',
    nodeId: id,
    entityId: id,
    summary: `Nœud créé : ${path}`,
    client: ctx.client,
    before: null,
    after: { id },
  });
  return { id, path };
}

export function updateNode(
  ctx: WriteContext,
  input: {
    id: string;
    title?: string;
    type?: NodeType;
    summary?: string | null;
    parentId?: string | null;
  },
) {
  const before = readNodeState(ctx, input.id);
  if (!before) throw notFound('Nœud');
  const changes = check(updateNodeInputSchema, {
    id: input.id,
    ...(input.title !== undefined && { title: input.title }),
    ...(input.type !== undefined && { nodeType: input.type }),
    ...(input.summary !== undefined && { summary: input.summary ?? '' }),
  });
  const nodes = new NodeService(() => ctx);
  nodes.update(changes);
  if (input.parentId !== undefined && input.parentId !== before.parentId) {
    nodes.move({ id: input.id, parentId: input.parentId });
  }
  const after = readNodeState(ctx, input.id)!;
  const changed = (Object.keys(after) as (keyof NodeState)[]).filter(
    (key) => after[key] !== before[key],
  );
  if (changed.length === 0) {
    return { id: input.id, path: pathOf(ctx, input.id), changed };
  }
  const path = pathOf(ctx, input.id);
  recordAssistantChange(ctx, {
    action: 'update_node',
    nodeId: input.id,
    entityId: input.id,
    summary: `Nœud modifié (${changed.join(', ')}) : ${path}`,
    client: ctx.client,
    before,
    after,
  });
  return { id: input.id, path, changed };
}

export function addDocument(
  ctx: WriteContext,
  input: {
    nodeId: string;
    title: string;
    contentType: ContentType;
    language?: string | null;
    body: string;
  },
) {
  const title = check(nodeTitleSchema, input.title);
  const contentType = check(contentTypeSchema, input.contentType);
  const language =
    contentType === 'code'
      ? check(languageSchema, input.language ?? null)
      : null;
  const documents = new DocumentService(() => ctx);
  const created = documents.create({
    nodeId: input.nodeId,
    title,
    contentType,
    language,
  });
  const { body } = check(updateDocumentInputSchema, {
    id: created.id,
    body: input.body,
  });
  documents.update({ id: created.id, body });
  const path = `${pathOf(ctx, input.nodeId)} > ${title}`;
  recordAssistantChange(ctx, {
    action: 'create_document',
    nodeId: input.nodeId,
    entityId: created.id,
    summary: `Document ajouté : ${path}`,
    client: ctx.client,
    before: null,
    after: readDocumentState(ctx, created.id)!,
  });
  return { id: created.id, path };
}

export function updateDocument(
  ctx: WriteContext,
  input: {
    id: string;
    title?: string;
    body?: string;
    mode: 'replace' | 'append';
  },
) {
  const before = readDocumentState(ctx, input.id);
  if (!before) throw notFound('Document');
  let body = input.body;
  if (body !== undefined && input.mode === 'append' && before.body) {
    const separator = before.body.endsWith('\n') ? '\n' : '\n\n';
    body = `${before.body}${separator}${body}`;
  }
  const changes = check(updateDocumentInputSchema, {
    id: input.id,
    ...(input.title !== undefined && { title: input.title }),
    ...(body !== undefined && { body }),
  });
  const documents = new DocumentService(() => ctx);
  const updated = documents.update(changes);
  const after = readDocumentState(ctx, input.id)!;
  const path = `${pathOf(ctx, updated.nodeId)} > ${after.title}`;
  if (after.title !== before.title || after.body !== before.body) {
    recordAssistantChange(ctx, {
      action: 'update_document',
      nodeId: updated.nodeId,
      entityId: input.id,
      summary: `Document ${input.mode === 'append' ? 'complété' : 'modifié'} : ${path}`,
      client: ctx.client,
      before,
      after,
    });
  }
  return { id: input.id, path, totalChars: after.body.length };
}

export function link(
  ctx: WriteContext,
  input: {
    sourceId: string;
    targetId: string;
    relation: string;
    label?: string;
    description?: string;
    createRelationType?: boolean;
  },
) {
  const relationTypes = new RelationTypeService(() => ctx);
  const name = check(relationTypeNameSchema, input.relation);
  const types = relationTypes.list();
  let type = types.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  );
  if (!type) {
    if (!input.createRelationType) {
      throw new NodalError(
        'NOT_FOUND',
        `Type de relation ${quoted(name)} inconnu. Types existants : ${types
          .map((candidate) => candidate.name)
          .join(', ')}. Passez createRelationType: true pour le créer.`,
      );
    }
    type = relationTypes.create({ name });
  }
  const edgeInput = check(createEdgeInputSchema, {
    sourceId: input.sourceId,
    targetId: input.targetId,
    relationTypeId: type.id,
    ...(input.label !== undefined && { label: input.label }),
    ...(input.description !== undefined && {
      description: input.description,
    }),
  });
  const edge = new EdgeService(() => ctx).create(edgeInput);
  const summary = `Relation ajoutée : ${pathOf(ctx, input.sourceId)} —${type.name}→ ${pathOf(ctx, input.targetId)}`;
  recordAssistantChange(ctx, {
    action: 'link',
    nodeId: input.sourceId,
    entityId: edge.id,
    summary,
    client: ctx.client,
    before: null,
    after: { edgeId: edge.id },
  });
  return { id: edge.id, relation: type.name };
}

export function tagNode(
  ctx: WriteContext,
  input: { nodeId: string; add?: string[]; remove?: string[] },
) {
  nodeType(ctx, input.nodeId);
  const current = listNodeTags(ctx, input.nodeId);
  const removed = new Set(
    (input.remove ?? []).map((name) => name.trim().toLowerCase()),
  );
  const kept = current
    .filter((existing) => !removed.has(existing.name.toLowerCase()))
    .map((existing) => existing.id);
  const tagIds = [...new Set([...kept, ...resolveTags(ctx, input.add ?? [])])];
  const before = current.map((existing) => existing.id);
  const unchanged =
    tagIds.length === before.length &&
    tagIds.every((id) => before.includes(id));
  const after = unchanged
    ? current
    : new NodeService(() => ctx).setTags({ id: input.nodeId, tagIds });
  if (!unchanged) {
    recordAssistantChange(ctx, {
      action: 'tag',
      nodeId: input.nodeId,
      entityId: input.nodeId,
      summary: `Tags de ${pathOf(ctx, input.nodeId)} : ${after.map((t) => t.name).join(', ') || 'aucun'}`,
      client: ctx.client,
      before: { tagIds: before },
      after: { tagIds: after.map((t) => t.id) },
    });
  }
  return { nodeId: input.nodeId, tags: after.map((t) => t.name).join(', ') };
}
