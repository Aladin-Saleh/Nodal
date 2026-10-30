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
import { NodalError } from '../shared/errors';
import type { ShortIds } from './short-ids';
import {
  addDocument,
  createNode,
  link,
  tagNode,
  updateDocument,
  updateNode,
  type WriteContext,
} from './write-tools';

/** Au-delà, l'appel est refusé : mieux vaut le découper. */
export const APPLY_MAX_OPERATIONS = 100;

/** Identifiant (préfixe affiché ou UUID) ou référence « $n ». */
const target = z.string().min(1).max(100);
const tagNames = z.array(z.string().min(1).max(100)).max(50);

export const operationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('createNode'),
    title: z.string().min(1).max(200),
    type: z.enum(NODE_TYPES),
    parentId: target.nullable().optional(),
    summary: z.string().max(2000).optional(),
    tags: tagNames.optional(),
    allowDuplicate: z.boolean().optional(),
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
  }),
  z.object({
    op: z.literal('tag'),
    nodeId: target,
    add: tagNames.optional(),
    remove: tagNames.optional(),
  }),
]);

export type Operation = z.infer<typeof operationSchema>;

/** Champs d'une opération qui désignent un nœud ou un document. */
const ID_FIELDS = ['id', 'parentId', 'nodeId', 'sourceId', 'targetId'] as const;

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
  const results: { ref: string; op: Operation['op']; id: string }[] = [];

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
      const id = run(ctx, resolved as Operation);
      produced.push(id);
      results.push({ ref: `$${position}`, op: operation.op, id });
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

/** Exécute une opération ; renvoie l'identifiant de l'élément touché. */
function run(ctx: WriteContext, operation: Operation): string {
  switch (operation.op) {
    case 'createNode': {
      const { op: _op, ...input } = operation;
      return createNode(ctx, input).id;
    }
    case 'updateNode': {
      const { op: _op, ...input } = operation;
      return updateNode(ctx, input).id;
    }
    case 'addDocument': {
      const { op: _op, ...input } = operation;
      return addDocument(ctx, input).id;
    }
    case 'updateDocument': {
      const { op: _op, ...input } = operation;
      return updateDocument(ctx, input).id;
    }
    case 'link': {
      const { op: _op, ...input } = operation;
      return link(ctx, input).id;
    }
    case 'tag': {
      const { op: _op, ...input } = operation;
      return tagNode(ctx, input).nodeId;
    }
  }
}
