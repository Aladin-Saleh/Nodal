/**
 * Écriture groupée (nodal_apply) : une liste ordonnée d'opérations exécutées
 * dans la transaction de l'appel, via les mêmes fonctions que les outils
 * unitaires (mêmes règles, même journal assistant_change). Enregistrer une
 * notion — nœud, documents, relations, tags — tient alors en un seul appel
 * au lieu de trois ou quatre, chacun coûtant un tour de conversation.
 *
 * Une opération peut désigner l'élément créé par une opération précédente du
 * même appel : « $1 » pour la première, « $2 » pour la deuxième, etc. Tout ou
 * rien : la première erreur annule l'appel entier.
 */
import * as z from 'zod';
import { CONTENT_TYPES, NODE_TYPES } from '../shared/domain';
import { ANCHORS_MAX_PER_NODE } from '../shared/code-anchors';
import {
  LESSON_NODES_MAX,
  LESSON_NOTE_MAX_LENGTH,
  LESSON_OUTCOMES,
  LESSON_QUESTION_MAX_LENGTH,
} from '../shared/lessons';
import {
  CONFIDENCES,
  EVIDENCE_QUOTE_MAX_LENGTH,
  EVIDENCE_SOURCE_MAX_LENGTH,
} from '../shared/evidence';
import { NodalError } from '../shared/errors';
import { DocumentService } from '../main/knowledge/document-service';
import type { ShortIds } from './short-ids';
import {
  addDocument,
  addLesson,
  anchorFiles,
  createNode,
  link,
  reviewFiles,
  tagNode,
  updateDocument,
  updateNode,
  type WriteContext,
} from './write-tools';
import { saveView } from './views';

/** Au-delà, l'appel est refusé : mieux vaut le découper. */
export const APPLY_MAX_OPERATIONS = 100;

/** Identifiant (préfixe affiché ou UUID) ou référence « $n ». */
const target = z.string().min(1).max(100);
const tagNames = z.array(z.string().min(1).max(100)).max(50);
/** Nœuds d'une vue (masqués, repliés…). */
const targets = z.array(target).max(500);
/** Chemins (absolus ou relatifs) ou motifs glob de fichiers du code. */
const anchorPaths = z
  .array(z.string().min(1).max(1000))
  .max(ANCHORS_MAX_PER_NODE);

export const confidenceSchema = z.enum(CONFIDENCES);
/** Source d'une relation : fichier (ligne éventuelle), document, adresse. */
export const evidenceSchema = z.object({
  source: z.string().min(1).max(EVIDENCE_SOURCE_MAX_LENGTH),
  quote: z.string().max(EVIDENCE_QUOTE_MAX_LENGTH).optional(),
});

export const operationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('createNode'),
    title: z.string().min(1).max(200),
    type: z.enum(NODE_TYPES),
    parentId: target.nullable().optional(),
    summary: z.string().max(2000).optional(),
    tags: tagNames.optional(),
    allowDuplicate: z.boolean().optional(),
    template: z.string().min(1).max(100).optional(),
  }),
  z.object({
    op: z.literal('updateNode'),
    id: target,
    title: z.string().min(1).max(200).optional(),
    type: z.enum(NODE_TYPES).optional(),
    summary: z.string().max(2000).nullable().optional(),
    parentId: target.nullable().optional(),
  }),
  z.object({
    op: z.literal('addDocument'),
    nodeId: target,
    title: z.string().min(1).max(200),
    contentType: z.enum(CONTENT_TYPES),
    language: z.string().max(50).nullable().optional(),
    body: z.string(),
  }),
  z.object({
    op: z.literal('updateDocument'),
    id: target,
    title: z.string().min(1).max(200).optional(),
    body: z.string().optional(),
    mode: z.enum(['append', 'replace']).default('append'),
  }),
  z.object({
    op: z.literal('link'),
    sourceId: target,
    targetId: target,
    relation: z.string().min(1).max(100),
    label: z.string().max(200).optional(),
    description: z.string().max(2000).optional(),
    createRelationType: z.boolean().optional(),
    confidence: confidenceSchema.optional(),
    evidence: evidenceSchema.optional(),
  }),
  z.object({
    op: z.literal('tag'),
    nodeId: target,
    add: tagNames.optional(),
    remove: tagNames.optional(),
  }),
  z.object({
    op: z.literal('anchor'),
    nodeId: target,
    add: anchorPaths.optional(),
    remove: anchorPaths.optional(),
  }),
  z.object({
    op: z.literal('review'),
    nodeId: target,
    files: anchorPaths.min(1),
  }),
  z.object({
    op: z.literal('lesson'),
    question: z.string().min(1).max(LESSON_QUESTION_MAX_LENGTH),
    outcome: z.enum(LESSON_OUTCOMES),
    nodeIds: z.array(target).max(LESSON_NODES_MAX).optional(),
    note: z.string().max(LESSON_NOTE_MAX_LENGTH).optional(),
  }),
  z.object({
    op: z.literal('view'),
    name: z.string().min(1).max(100),
    types: z.array(z.enum(NODE_TYPES)).max(NODE_TYPES.length).optional(),
    tags: tagNames.optional(),
    hide: targets.optional(),
    show: targets.optional(),
    solo: target.nullable().optional(),
    collapse: targets.optional(),
    expand: targets.optional(),
    hideRelations: z.array(z.string().min(1).max(100)).max(50).optional(),
    hierarchy: z.boolean().optional(),
  }),
]);

export type Operation = z.infer<typeof operationSchema>;

/** Champs d'une opération qui désignent un nœud ou un document. */
const ID_FIELDS = [
  'id',
  'parentId',
  'nodeId',
  'sourceId',
  'targetId',
  'solo',
] as const;
/** Champs d'une opération qui listent des nœuds. */
const ID_LIST_FIELDS = [
  'nodeIds',
  'hide',
  'show',
  'collapse',
  'expand',
] as const;

const REFERENCE = /^\$(\d+)$/;

/**
 * Exécute les opérations dans l'ordre. `ids` résout les préfixes affichés ;
 * les références « $n » renvoient à l'élément créé (ou modifié) par la n-ième
 * opération. Le résultat liste l'identifiant de chaque élément touché.
 */
export function applyOperations(
  ctx: WriteContext,
  operations: readonly Operation[],
  ids: ShortIds,
) {
  if (operations.length === 0) {
    throw new NodalError('VALIDATION_ERROR', 'Aucune opération à appliquer.');
  }
  if (operations.length > APPLY_MAX_OPERATIONS) {
    throw new NodalError(
      'VALIDATION_ERROR',
      `Trop d'opérations (${operations.length}, ${APPLY_MAX_OPERATIONS} au plus) : découpez l'appel.`,
    );
  }
  const produced: string[] = [];
  const results: {
    ref: string;
    op: Operation['op'];
    id: string;
    documentId?: string;
    note?: string;
  }[] = [];

  operations.forEach((operation, index) => {
    const position = index + 1;
    try {
      const resolve = (value: string): string => {
        const reference = REFERENCE.exec(value.trim());
        if (!reference) return ids.resolve(value);
        const n = Number(reference[1]);
        const id = produced[n - 1];
        if (n < 1 || n >= position || !id) {
          throw new NodalError(
            'VALIDATION_ERROR',
            `référence ${value} invalide : seules $1 à $${position - 1} existent à ce stade.`,
          );
        }
        return id;
      };
      const resolved = { ...operation } as Record<string, unknown>;
      for (const field of ID_FIELDS) {
        const value = resolved[field];
        if (typeof value === 'string') resolved[field] = resolve(value);
      }
      for (const field of ID_LIST_FIELDS) {
        const value = resolved[field];
        if (Array.isArray(value)) resolved[field] = value.map(resolve);
      }
      const { id, documentId, note } = run(ctx, resolved as Operation);
      produced.push(id);
      results.push({
        ref: `$${position}`,
        op: operation.op,
        id,
        ...(documentId && { documentId }),
        ...(note && { note }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NodalError(
        error instanceof NodalError ? error.code : 'VALIDATION_ERROR',
        `Opération ${position} (${operation.op}) : ${message} Rien n'a été enregistré.`,
      );
    }
  });
  return { applied: results.length, results };
}

/** Contenu JSON qui ne s'analyse pas : signalé, jamais refusé. */
function jsonNote(contentType: string, body: string): string | undefined {
  if (contentType !== 'json' || body.trim() === '') return undefined;
  try {
    JSON.parse(body);
    return undefined;
  } catch (error) {
    return `JSON invalide : ${(error as Error).message}`;
  }
}

/**
 * Exécute une opération ; renvoie l'identifiant de l'élément touché (et du
 * document créé par un modèle).
 */
function run(
  ctx: WriteContext,
  operation: Operation,
): { id: string; documentId?: string; note?: string } {
  switch (operation.op) {
    case 'createNode': {
      const { op: _op, ...input } = operation;
      return createNode(ctx, input);
    }
    case 'updateNode': {
      const { op: _op, ...input } = operation;
      return { id: updateNode(ctx, input).id };
    }
    case 'addDocument': {
      const { op: _op, ...input } = operation;
      return {
        id: addDocument(ctx, input).id,
        note: jsonNote(input.contentType, input.body),
      };
    }
    case 'updateDocument': {
      const { op: _op, ...input } = operation;
      const { id } = updateDocument(ctx, input);
      const after = new DocumentService(() => ctx).get(id);
      return { id, note: jsonNote(after.contentType, after.body) };
    }
    case 'link': {
      const { op: _op, ...input } = operation;
      const { id, confidence, note } = link(ctx, input);
      return {
        id,
        note: [confidence && `confiance ${confidence}`, note]
          .filter(Boolean)
          .join(' ; '),
      };
    }
    case 'tag': {
      const { op: _op, ...input } = operation;
      return { id: tagNode(ctx, input).nodeId };
    }
    case 'anchor': {
      const { op: _op, ...input } = operation;
      return { id: anchorFiles(ctx, input).nodeId };
    }
    case 'review': {
      const { op: _op, ...input } = operation;
      return { id: reviewFiles(ctx, input).nodeId };
    }
    case 'lesson': {
      const { op: _op, ...input } = operation;
      return { id: addLesson(ctx, input).id };
    }
    case 'view': {
      const { op: _op, ...input } = operation;
      const { id, shows } = saveView(ctx, input);
      return { id, note: shows };
    }
  }
}
