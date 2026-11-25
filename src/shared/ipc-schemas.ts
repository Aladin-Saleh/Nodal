/**
 * Schémas zod des arguments IPC. Chaque canal déclare le tuple exact de ses
 * arguments : tout argument manquant, en trop ou mal typé est refusé, ainsi
 * que toute propriété inconnue (objets stricts).
 */
import { CONFIDENCES } from './evidence';
import { MCP_CLIENTS } from './mcp-clients';
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_INPUT,
  TERMINAL_MAX_ROWS,
} from './terminal';
import { z } from 'zod';
import {
  ATTACHMENT_MAX_SIZE_LIMIT_BYTES,
  CODE_LANGUAGES,
  CONTENT_TYPES,
  DESCRIPTION_MAX_LENGTH,
  DOCUMENT_BODY_MAX_LENGTH,
  EDGE_LABEL_MAX_LENGTH,
  NODE_TYPES,
  RELATION_TYPE_NAME_MAX_LENGTH,
  SEARCH_QUERY_MAX_LENGTH,
  SUMMARY_MAX_LENGTH,
  TAG_NAME_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  GRAPH_VIEW_NAME_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
} from './domain';
import {
  ANCHOR_PATTERN_MAX_LENGTH,
  ANCHORS_MAX_PER_NODE,
} from './code-anchors';
import type { IpcArgs, IpcChannel } from './ipc-contract';
import { preferencesUpdateSchema } from './preferences';
import { templateIdSchema, templateListSchema } from './templates';

// Caractères de contrôle C0/C1 : interdits dans un libellé sur une ligne.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
// Contrôles sauf tabulation et retours à la ligne : interdits dans un texte libre.
const CONTROL_CHARS_MULTILINE =
  // oxlint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Libellé sur une ligne, normalisé (trim), obligatoire. */
function label(what: string, max: number) {
  return z
    .string()
    .trim()
    .min(1, `${what} est obligatoire.`)
    .max(max, `${what} ne doit pas dépasser ${max} caractères.`)
    .refine((value) => !CONTROL_CHARS.test(value), {
      message: `${what} contient des caractères non autorisés.`,
    });
}

/** Texte libre sur plusieurs lignes ; vide → null. */
function optionalText(what: string, max: number) {
  return z
    .string()
    .max(max, `${what} ne doit pas dépasser ${max} caractères.`)
    .refine((value) => !CONTROL_CHARS_MULTILINE.test(value), {
      message: `${what} contient des caractères non autorisés.`,
    })
    .transform((value) => (value.trim().length === 0 ? null : value))
    .nullable();
}

export const workspaceNameSchema = label(
  "Le nom de l'espace",
  WORKSPACE_NAME_MAX_LENGTH,
);
export const nodeTitleSchema = label('Le titre', TITLE_MAX_LENGTH);
export const tagNameSchema = label('Le nom du tag', TAG_NAME_MAX_LENGTH);

export const idSchema = z.string().min(1).max(100);
export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Couleur invalide (format #RRGGBB attendu).')
  .transform((value) => value.toLowerCase())
  .nullable();
export const nodeTypeSchema = z.enum(NODE_TYPES);
export const contentTypeSchema = z.enum(CONTENT_TYPES);
export const languageSchema = z.enum(CODE_LANGUAGES).nullable();

export const createWorkspaceInputSchema = z.strictObject({
  name: workspaceNameSchema,
});
export const updateWorkspaceInputSchema = z.strictObject({
  name: workspaceNameSchema.optional(),
  description: optionalText(
    'La description',
    DESCRIPTION_MAX_LENGTH,
  ).optional(),
});
export const workspaceSettingsSchema = z.strictObject({
  attachmentMaxSizeBytes: z
    .number()
    .int()
    .min(1024 * 1024, 'La taille maximale doit être d’au moins 1 Mo.')
    .max(
      ATTACHMENT_MAX_SIZE_LIMIT_BYTES,
      `La taille maximale ne peut pas dépasser ${ATTACHMENT_MAX_SIZE_LIMIT_BYTES / (1024 * 1024)} Mo.`,
    ),
});

/** Au-delà, une liste d'identifiants de la vue est refusée (garde-fou). */
export const VIEW_IDS_MAX = 50_000;
const viewIds = z.array(idSchema).max(VIEW_IDS_MAX);
export const graphViewSettingsSchema = z.strictObject({
  scope: z.enum(['all', 'neighborhood']).nullable(),
  depth: z.number().int().min(1).max(5),
  nodeTypes: z.array(z.enum(NODE_TYPES)).max(NODE_TYPES.length),
  tagIds: viewIds,
  hiddenRelationTypeIds: viewIds,
  showHierarchy: z.boolean(),
  collapsed: viewIds,
  // Absents des réglages enregistrés avant l'œil : valeurs par défaut.
  hidden: viewIds.default([]),
  solo: idSchema.nullable().default(null),
  assistantPendingOnly: z.boolean().default(false),
});

const idInput = z.strictObject({ id: idSchema });

/** Coordonnées d'affichage : nombres finis, bornés pour rester raisonnables. */
const coordinate = z.number().finite().min(-1e7).max(1e7);
const point = z.tuple([coordinate, coordinate, coordinate]);
export const graphCameraSchema = z.strictObject({
  position: point,
  target: point,
});
export const graphViewNameSchema = label(
  'Le nom de la vue',
  GRAPH_VIEW_NAME_MAX_LENGTH,
);
export const createGraphViewInputSchema = z.strictObject({
  name: graphViewNameSchema,
  settings: graphViewSettingsSchema,
  camera: graphCameraSchema.nullable(),
});
export const updateGraphViewInputSchema = z.strictObject({
  id: idSchema,
  name: graphViewNameSchema.optional(),
  settings: graphViewSettingsSchema.optional(),
  camera: graphCameraSchema.nullable().optional(),
});

export const createNodeInputSchema = z.strictObject({
  parentId: idSchema.nullable(),
  title: nodeTitleSchema,
  nodeType: nodeTypeSchema,
  templateId: templateIdSchema.nullable().optional(),
});
export const updateNodeInputSchema = z.strictObject({
  id: idSchema,
  title: nodeTitleSchema.optional(),
  nodeType: nodeTypeSchema.optional(),
  summary: optionalText('Le résumé', SUMMARY_MAX_LENGTH).optional(),
  color: colorSchema.optional(),
});
export const moveNodeInputSchema = z.strictObject({
  id: idSchema,
  parentId: idSchema.nullable(),
  index: z.number().int().min(0).optional(),
});
export const duplicateNodeInputSchema = z.strictObject({
  id: idSchema,
  includeChildren: z.boolean(),
});
export const deleteNodeInputSchema = z.strictObject({
  id: idSchema,
  childrenStrategy: z.enum(['reparent', 'delete']),
});
export const setNodeTagsInputSchema = z.strictObject({
  id: idSchema,
  tagIds: z.array(idSchema).max(500),
});

export const createDocumentInputSchema = z.strictObject({
  nodeId: idSchema,
  title: nodeTitleSchema,
  contentType: contentTypeSchema,
  language: languageSchema.optional(),
  templateId: templateIdSchema.optional(),
});
export const updateDocumentInputSchema = z.strictObject({
  id: idSchema,
  title: nodeTitleSchema.optional(),
  // Le contenu est conservé tel quel (§6.6) : ni trim ni filtrage.
  body: z
    .string()
    .max(
      DOCUMENT_BODY_MAX_LENGTH,
      'Le document est trop volumineux pour être enregistré.',
    )
    .optional(),
  language: languageSchema.optional(),
});
export const reorderDocumentsInputSchema = z.strictObject({
  nodeId: idSchema,
  orderedIds: z.array(idSchema).max(10_000),
});

export const createTagInputSchema = z.strictObject({
  name: tagNameSchema,
  color: colorSchema.optional(),
});
export const updateTagInputSchema = z.strictObject({
  id: idSchema,
  name: tagNameSchema.optional(),
  color: colorSchema.optional(),
});

export const relationTypeNameSchema = label(
  'Le nom du type de relation',
  RELATION_TYPE_NAME_MAX_LENGTH,
);
export const createRelationTypeInputSchema = z.strictObject({
  name: relationTypeNameSchema,
  color: colorSchema.optional(),
});
export const updateRelationTypeInputSchema = z.strictObject({
  id: idSchema,
  name: relationTypeNameSchema.optional(),
  color: colorSchema.optional(),
});

/** Libellé facultatif d'une relation : vide → null. */
const edgeLabelSchema = z
  .string()
  .trim()
  .max(
    EDGE_LABEL_MAX_LENGTH,
    `Le libellé ne doit pas dépasser ${EDGE_LABEL_MAX_LENGTH} caractères.`,
  )
  .refine((value) => !CONTROL_CHARS.test(value), {
    message: 'Le libellé contient des caractères non autorisés.',
  })
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const createEdgeInputSchema = z.strictObject({
  sourceId: idSchema,
  targetId: idSchema,
  relationTypeId: idSchema,
  label: edgeLabelSchema.optional(),
  description: optionalText(
    'La description',
    DESCRIPTION_MAX_LENGTH,
  ).optional(),
  confidence: z.enum(CONFIDENCES).nullable().optional(),
});
export const updateEdgeInputSchema = z.strictObject({
  id: idSchema,
  relationTypeId: idSchema.optional(),
  label: edgeLabelSchema.optional(),
  description: optionalText(
    'La description',
    DESCRIPTION_MAX_LENGTH,
  ).optional(),
  confidence: z.enum(CONFIDENCES).nullable().optional(),
});

export const savePositionsInputSchema = z.strictObject({
  positions: z
    .array(
      z.strictObject({
        id: idSchema,
        x: coordinate,
        y: coordinate,
        z: coordinate,
      }),
    )
    .max(100_000),
});

const idListSchema = z.array(idSchema).min(1).max(10_000);

/** Capture rapide : un titre, une note facultative (document Markdown). */
export const captureInputSchema = z.strictObject({
  title: label('Le titre', TITLE_MAX_LENGTH),
  note: optionalText('La note', DOCUMENT_BODY_MAX_LENGTH),
});

const noArgs = z.tuple([]);
const one = <T extends z.ZodType>(schema: T) => z.tuple([schema]);

export const ipcArgsSchemas = {
  'app:getInfo': noArgs,
  'app:setUnsavedChanges': one(z.boolean()),
  'preferences:get': noArgs,
  'preferences:update': one(preferencesUpdateSchema),
  'capture:getTarget': noArgs,
  'capture:submit': one(captureInputSchema),
  'capture:open': noArgs,
  'capture:getInbox': noArgs,
  'capture:shortcutStatus': noArgs,

  'workspace:create': one(createWorkspaceInputSchema),
  'workspace:open': noArgs,
  'workspace:openRecent': one(idInput),
  'workspace:listRecent': noArgs,
  'workspace:removeRecent': one(idInput),
  'workspace:close': noArgs,
  'workspace:getCurrent': noArgs,
  'workspace:update': one(updateWorkspaceInputSchema),
  'workspace:delete': noArgs,
  'workspace:getSettings': noArgs,
  'workspace:updateSettings': one(workspaceSettingsSchema),
  'view:getGraph': noArgs,
  'view:saveGraph': one(graphViewSettingsSchema),
  'graphView:list': noArgs,
  'graphView:create': one(createGraphViewInputSchema),
  'graphView:update': one(updateGraphViewInputSchema),
  'graphView:delete': one(idInput),
  'graphView:setDefault': one(z.strictObject({ id: idSchema.nullable() })),

  'node:list': noArgs,
  'node:backlinks': one(idInput),
  'suggestion:listForNode': one(idInput),
  'health:report': noArgs,
  'duplicate:ignore': one(
    z.strictObject({ firstId: idSchema, secondId: idSchema }),
  ),
  'gap:setStatus': one(
    z.strictObject({
      key: z.string().min(1).max(500),
      status: z.enum(['done', 'ignored']),
    }),
  ),
  'suggestion:accept': one(
    z.strictObject({
      sourceId: idSchema,
      targetId: idSchema,
      mode: z.enum(['relation', 'link']),
    }),
  ),
  'suggestion:ignore': one(
    z.strictObject({ sourceId: idSchema, targetId: idSchema }),
  ),
  'code:getRoots': noArgs,
  'code:addRoot': noArgs,
  'code:removeRoot': one(z.strictObject({ path: z.string().min(1).max(4096) })),
  'terminal:listShells': noArgs,
  'terminal:create': one(
    z.strictObject({
      cols: z.number().int().min(1).max(TERMINAL_MAX_COLS),
      rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS),
      // Identifiant d'un shell détecté par le main, jamais un programme.
      shell: z.string().min(1).max(100).optional(),
    }),
  ),
  'terminal:write': one(
    z.strictObject({
      id: z.string().min(1).max(20),
      data: z.string().max(TERMINAL_MAX_INPUT),
    }),
  ),
  'terminal:resize': one(
    z.strictObject({
      id: z.string().min(1).max(20),
      cols: z.number().int().min(1).max(TERMINAL_MAX_COLS),
      rows: z.number().int().min(1).max(TERMINAL_MAX_ROWS),
    }),
  ),
  'terminal:close': one(z.strictObject({ id: z.string().min(1).max(20) })),
  'assistant:connect': one(
    z.strictObject({ client: z.enum(MCP_CLIENTS), allowWrites: z.boolean() }),
  ),
  'anchor:listForNode': one(idInput),
  'anchor:set': one(
    z.strictObject({
      nodeId: idSchema,
      patterns: z
        .array(z.string().min(1).max(ANCHOR_PATTERN_MAX_LENGTH))
        .max(ANCHORS_MAX_PER_NODE),
    }),
  ),
  'anchor:pickFiles': one(idInput),
  'anchor:markReviewed': one(idInput),
  'anchor:staleNodes': noArgs,
  'node:get': one(idInput),
  'node:create': one(createNodeInputSchema),
  'node:update': one(updateNodeInputSchema),
  'node:move': one(moveNodeInputSchema),
  'node:writeSchema': one(idInput),
  'node:mergePreview': one(
    z.strictObject({ firstId: idSchema, secondId: idSchema }),
  ),
  'node:merge': one(z.strictObject({ keepId: idSchema, dropId: idSchema })),
  'node:duplicate': one(duplicateNodeInputSchema),
  'node:getDeletionImpact': one(idInput),
  'node:delete': one(deleteNodeInputSchema),
  'node:setTags': one(setNodeTagsInputSchema),
  'node:moveMany': one(
    z.strictObject({ ids: idListSchema, parentId: idSchema.nullable() }),
  ),
  'node:setTypeMany': one(
    z.strictObject({ ids: idListSchema, nodeType: nodeTypeSchema }),
  ),
  'node:getDeletionImpactMany': one(z.strictObject({ ids: idListSchema })),
  'node:deleteMany': one(
    z.strictObject({
      ids: idListSchema,
      childrenStrategy: z.enum(['reparent', 'delete']),
    }),
  ),

  'document:get': one(idInput),
  'document:create': one(createDocumentInputSchema),
  'template:list': noArgs,
  'template:save': one(z.strictObject({ templates: templateListSchema })),
  'template:reset': noArgs,
  'document:update': one(updateDocumentInputSchema),
  'document:delete': one(idInput),
  'document:reorder': one(reorderDocumentsInputSchema),

  'tag:list': noArgs,
  'tag:create': one(createTagInputSchema),
  'tag:update': one(updateTagInputSchema),
  'tag:delete': one(idInput),

  'attachment:add': one(z.strictObject({ nodeId: idSchema })),
  'attachment:save': one(idInput),
  'attachment:delete': one(idInput),

  'relationType:list': noArgs,
  'relationType:create': one(createRelationTypeInputSchema),
  'relationType:update': one(updateRelationTypeInputSchema),
  'relationType:delete': one(idInput),

  'edge:listForNode': one(idInput),
  'edge:create': one(createEdgeInputSchema),
  'edge:update': one(updateEdgeInputSchema),
  'edge:delete': one(idInput),

  'graph:get': noArgs,
  'graph:savePositions': one(savePositionsInputSchema),

  'search:query': one(
    z.strictObject({ query: z.string().max(SEARCH_QUERY_MAX_LENGTH) }),
  ),
  'workspace:export': noArgs,
  'workspace:exportVault': noArgs,
  'workspace:compare': noArgs,
  'workspace:exportLlm': one(
    z.strictObject({
      scope: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('workspace') }),
        z.strictObject({ kind: z.literal('subtree'), nodeId: idSchema }),
        z.strictObject({
          kind: z.literal('neighborhood'),
          nodeId: idSchema,
          depth: z.number().int().min(1).max(10),
        }),
      ]),
      maxTokens: z.number().int().min(64).max(32_000),
    }),
  ),
  'workspace:import': noArgs,
  'workspace:backup': noArgs,
  'markdownImport:pick': noArgs,
  'markdownImport:run': one(z.strictObject({ token: idSchema })),
  'markdownImport:cancel': noArgs,
  'assistant:listChanges': noArgs,
  'assistant:undo': one(idInput),
  'lesson:list': noArgs,
  'lesson:delete': one(idInput),
  'assistant:validateNodes': one(
    z.strictObject({ ids: z.array(idSchema).min(1).max(10_000) }),
  ),
  'workspace:checkIntegrity': noArgs,
} satisfies { [C in IpcChannel]: z.ZodType<IpcArgs<C>> };
