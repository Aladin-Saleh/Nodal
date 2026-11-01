/**
 * Serveur MCP de Nodal : outils de lecture et (sauf `readOnly`) d'écriture
 * sur un fichier .nodal, dont les réponses structurées sont encodées en TOON
 * (Token-Oriented Object Notation), plus compact que JSON pour les listes
 * homogènes. Le contenu des documents est renvoyé tel quel, hors TOON, pour
 * ne pas l'échapper. Chaque écriture est tracée et annulable dans Nodal.
 */
import { encode as encodeToon } from '@toon-format/toon';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { CONTENT_TYPES, NODE_TYPES } from '../shared/domain';
import { NodalError } from '../shared/errors';
import {
  DEFAULT_DOCUMENT_CHARS,
  DEFAULT_MAX_ROWS,
  DEFAULT_SEARCH_CHARS,
  getNode,
  type FoundDocument,
  neighborhood,
  overview,
  findPath,
  health,
  HEALTH_MCP_LIMIT,
  readDocument,
  search,
  tree,
  anchorCheck,
  codeRootsFor,
  changedFilesText,
  DEFAULT_FOR_FILES_CHARS,
  forFiles,
  staleRow,
  type AnchorCheck,
} from './tools';
import { findStaleNodes } from '../main/code/code-check';
import type { StaleNode } from '../shared/code-anchors';
import {
  APPLY_MAX_OPERATIONS,
  applyOperations,
  operationSchema,
  type Operation,
} from './apply-tool';
import { PATH_DEFAULT_DEPTH, PATH_MAX_DEPTH } from '../shared/graph-path';
import { loadShortIds, resolveIds, shortenIds } from './short-ids';
import { renderLinksForLlm, renderResponseLinks } from './links';
import { recordSearchGap } from '../main/knowledge/health-service';
import { workspaceLinkResolver } from '../main/knowledge/link-service';
import type { LinkResolver } from '../shared/wiki-links';
import {
  withWorkspace,
  type AccessMode,
  type ReadContext,
} from './workspace-reader';
import {
  addDocument,
  createNode,
  link,
  tagNode,
  updateDocument,
  updateNode,
  type WriteContext,
} from './write-tools';

// Consignes envoyées à chaque tour de conversation : l'essentiel seulement.
// Le bloc CLAUDE.md / AGENTS.md (McpDialog) ne fait que déclencher la
// consultation ; le mode d'emploi des outils est ici, une seule fois.
const READ_INSTRUCTIONS = `Nodal : base de connaissances en nœuds hiérarchiques typés, avec documents
(markdown, texte, json, code, mermaid) et relations nommées entre nœuds.

Réponses en TOON : \`clé: valeur\`, et pour une liste \`nom[N]{champ1,champ2}:\`
puis une ligne par élément. Identifiants abrégés : réutilisez-les tels quels.
createdBy / by = "assistant" : ajouté par une IA, moins sûr tant que
l'utilisateur ne l'a pas validé.

Commencez par nodal_search : résumés des nœuds et contenu (ou sections) des
documents trouvés, souvent suffisants. Question à plusieurs volets : plusieurs
recherches en parallèle. Pour approfondir : nodal_get_node, nodal_read_document,
nodal_tree, nodal_neighborhood ; nodal_overview si la question est vague.
Avant de modifier du code : nodal_for_files.`;

const WRITE_INSTRUCTIONS = `

Enrichissez la base avec ce qui est durable (nodal_health : lacunes et
sujets à documenter) : complétez le nœud existant
(cherchez d'abord) plutôt que d'en créer un ; résumé d'une ou deux phrases,
détail dans des documents, relations avec les types existants. Plusieurs
écritures : nodal_apply (un appel, une transaction). Rien n'est supprimé ;
tout est journalisé et annulable par l'utilisateur. Après avoir modifié du
code : mettez ses nœuds à jour, ancrez les nouveaux fichiers (op anchor).`;

const READ_ONLY_INSTRUCTIONS = `

Accès en lecture seule.`;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
/** Ajout sans perte : création, relation. */
const ADDITIVE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
/** Remplace une valeur existante (annulable depuis Nodal). */
const OVERWRITING = { ...ADDITIVE, destructiveHint: true } as const;

const id = z.string().min(1).max(100);
const maxRows = z.number().int().min(1).max(2000).optional();
const nodeType = z.enum(NODE_TYPES);
const tagNames = z.array(z.string().min(1).max(100)).max(50);

export interface NodalMcpServerOptions {
  workspaceFile: string;
  version: string;
  /** N'expose que les outils de lecture. */
  readOnly?: boolean;
  /**
   * Dossier du projet (dépôt git) d'où le client a lancé le serveur :
   * dossier de code par défaut quand l'espace n'en déclare aucun.
   */
  projectRoot?: string | null;
}

/**
 * Document renvoyé avec une réponse : une ligne d'en-tête, puis le contenu
 * brut (hors TOON, pour ne pas l'échapper) — entier, ou les sections
 * trouvées, chacune avec sa position pour lire la suite.
 */
function formatFoundDocument(doc: FoundDocument): string {
  const kind = doc.language
    ? `${doc.contentType}, ${doc.language}`
    : doc.contentType;
  const header = `--- document ${doc.id} « ${doc.title} » (${kind}) · ${doc.path}`;
  if (doc.body !== null) return `${header}\n${doc.body}`;
  const sections = doc.sections.map((part) => {
    const where = part.offset === null ? '' : ` (offset ${part.offset})`;
    return `§ ${part.section ?? 'extrait'}${where}\n${part.content}`;
  });
  return [
    `${header} · ${doc.totalChars} car., sections trouvées :`,
    ...sections,
    `[suite : nodal_read_document id=${doc.id} offset=…]`,
  ].join('\n\n');
}

/** Réponse TOON suivie des documents qu'elle inclut. */
function withDocuments(data: {
  result: unknown;
  documents: FoundDocument[];
}): CallToolResult {
  return {
    content: [
      { type: 'text', text: encodeToon(data.result) },
      ...data.documents.map((doc) => ({
        type: 'text' as const,
        text: formatFoundDocument(doc),
      })),
    ],
  };
}

function failure(error: unknown): CallToolResult {
  const message =
    error instanceof NodalError
      ? error.message
      : `Erreur interne : ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Nœuds possiblement obsolètes parmi ceux d'une réponse : lit le disque et
 * git une fois la connexion refermée. Un échec n'empêche pas de répondre.
 */
async function staleOf(check: AnchorCheck): Promise<StaleNode[]> {
  if (check.roots.length === 0 || check.nodes.length === 0) return [];
  try {
    return await findStaleNodes(check.roots, check.nodes);
  } catch {
    return [];
  }
}

/** Champ `stale` d'une réponse, absent s'il n'y a rien à signaler. */
const staleField = (stale: StaleNode[]) =>
  stale.length > 0 ? { stale: stale.map(staleRow) } : {};

export function createNodalMcpServer(
  options: NodalMcpServerOptions,
): McpServer {
  const codeRootsOf = (ctx: ReadContext) =>
    codeRootsFor(ctx, options.workspaceFile, options.projectRoot ?? null);
  const server = new McpServer(
    { name: 'nodal', title: 'Nodal', version: options.version },
    {
      instructions:
        READ_INSTRUCTIONS +
        (options.readOnly ? READ_ONLY_INSTRUCTIONS : WRITE_INSTRUCTIONS),
    },
  );

  /**
   * Exécute un appel : les identifiants courts reçus sont résolus en UUID,
   * ceux de la réponse sont raccourcis (après l'écriture, pour inclure les
   * éléments créés).
   */
  const call = <A, R>(
    args: A,
    mode: AccessMode,
    fn: (ctx: ReadContext, args: A) => R,
  ): R =>
    withWorkspace(
      options.workspaceFile,
      (ctx) => {
        const result = fn(ctx, resolveIds(args, loadShortIds(ctx)));
        const ids = loadShortIds(ctx);
        // Liens [[...]] des documents servis : titre courant + id court.
        let resolver: LinkResolver | null = null;
        const readable = renderResponseLinks(result, (text) => {
          if (!text.includes('[[')) return text;
          resolver ??= workspaceLinkResolver(ctx);
          return renderLinksForLlm(text, resolver, ids);
        });
        return shortenIds(readable, ids) as R;
      },
      mode,
    );

  /**
   * Recherche sans résultat : notée dans « Sujets à documenter » (requête,
   * date, nombre de fois ; rien d'autre). Jamais en lecture seule ; un échec
   * (fichier verrouillé…) n'empêche pas de répondre.
   */
  const noteSearchGap = (query: string) => {
    if (options.readOnly) return;
    try {
      withWorkspace(
        options.workspaceFile,
        (ctx) => recordSearchGap(ctx, query),
        'write',
      );
    } catch {
      // Journal facultatif.
    }
  };

  /** Exécute une lecture et encode son résultat en TOON. */
  const run =
    <A>(read: (ctx: ReadContext, args: A) => unknown) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        const data = call(args, 'read', read);
        return { content: [{ type: 'text', text: encodeToon(data) }] };
      } catch (error) {
        return failure(error);
      }
    };

  server.registerTool(
    'nodal_overview',
    {
      title: 'Vue d’ensemble',
      description:
        "Nom de l'espace, statistiques, types de relations, tags, nœuds racines, nœuds les plus reliés et activité récente. " +
        'Pour s’orienter quand la question est vague ; sinon, commencer par nodal_search.',
      annotations: READ_ONLY,
    },
    run(overview),
  );

  server.registerTool(
    'nodal_search',
    {
      title: 'Recherche plein texte',
      description:
        'Recherche par mots-clés (préfixes, sans accents) dans les titres, résumés et documents, ' +
        'à utiliser en premier. Renvoie les nœuds trouvés (chemin, résumé) puis, du plus pertinent au ' +
        'moins pertinent, chaque document trouvé : entier s’il est court, sinon ses sections qui ' +
        'contiennent les mots (avec leur offset), dans la limite de maxChars ; ' +
        'les autres documents trouvés sont cités par un extrait (otherMatches). Un nœud est retenu ' +
        's’il contient tous les mots, sinon (allTerms: false) au moins l’un d’eux. ' +
        'Question à plusieurs volets : plusieurs recherches en parallèle.',
      inputSchema: z.object({
        query: z.string().min(1).max(500).describe('Mots-clés'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Nombre maximal de nœuds'),
        maxChars: z
          .number()
          .int()
          .min(0)
          .max(100_000)
          .default(DEFAULT_SEARCH_CHARS)
          .describe(
            'Contenu de documents renvoyé au plus (0 : extraits seuls)',
          ),
      }),
      annotations: READ_ONLY,
      // Chargé d'emblée par Claude Code, sans passer par sa recherche d'outils :
      // c'est le premier appel de presque toute consultation.
      _meta: { 'anthropic/alwaysLoad': true },
    },
    async (args): Promise<CallToolResult> => {
      try {
        const found = call(args, 'read', (ctx, input: typeof args) => {
          const data = search(ctx, input);
          const ids = data.result.nodes.map((node) => node.id);
          return {
            ...data,
            check: anchorCheck(ctx, codeRootsOf(ctx), ids),
          };
        });
        if (found.result.nodeCount === 0) noteSearchGap(args.query);
        const stale = await staleOf(found.check);
        return withDocuments({
          result: { ...found.result, ...staleField(stale) },
          documents: found.documents,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'nodal_get_node',
    {
      title: 'Détail d’un nœud',
      description:
        'Un nœud avec son chemin, son résumé, ses tags, ses documents (taille en caractères ; ' +
        'contenu des documents courts inclus), ses enfants directs, ses relations, ses pièces jointes ' +
        'et les documents qui le mentionnent (mentionedIn).',
      inputSchema: z.object({ id: id.describe('Identifiant du nœud') }),
      annotations: READ_ONLY,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const found = call(args, 'read', (ctx, input: { id: string }) => {
          const data = getNode(ctx, input.id);
          return {
            ...data,
            check: anchorCheck(ctx, codeRootsOf(ctx), [input.id]),
          };
        });
        const [stale] = await staleOf(found.check);
        const { node } = found.result;
        return withDocuments({
          result: {
            ...found.result,
            node: stale
              ? {
                  ...node,
                  stale: `depuis ${stale.since.slice(0, 10)} : ${changedFilesText(stale)}`,
                }
              : node,
          },
          documents: found.documents,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'nodal_read_document',
    {
      title: 'Lire un document',
      description:
        'Contenu brut d’un document, précédé de ses métadonnées en TOON. Les longs documents ' +
        'se lisent par tranches : rappeler l’outil avec offset = nextOffset tant que nextOffset est non nul.',
      inputSchema: z.object({
        id: id.describe('Identifiant du document'),
        offset: z
          .number()
          .int()
          .min(0)
          .default(0)
          .describe('Position de départ (caractères)'),
        maxChars: z
          .number()
          .int()
          .min(100)
          .max(200_000)
          .default(DEFAULT_DOCUMENT_CHARS)
          .describe('Nombre maximal de caractères renvoyés'),
      }),
      annotations: READ_ONLY,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const { header, body } = call(args, 'read', readDocument);
        return {
          content: [
            { type: 'text', text: encodeToon(header) },
            { type: 'text', text: body },
          ],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'nodal_tree',
    {
      title: 'Arborescence',
      description:
        "Arborescence en profondeur d'abord, depuis les racines ou depuis un nœud. " +
        'depth = nombre de niveaux sous le point de départ (0 : le point de départ seul).',
      inputSchema: z.object({
        rootId: id
          .optional()
          .describe('Nœud de départ (absent : toutes les racines)'),
        depth: z.number().int().min(0).max(50).default(2),
        maxRows: maxRows.describe(
          `Nombre maximal de lignes (défaut ${DEFAULT_MAX_ROWS})`,
        ),
      }),
      annotations: READ_ONLY,
    },
    run(tree),
  );

  server.registerTool(
    'nodal_neighborhood',
    {
      title: 'Voisinage dans le graphe',
      description:
        "Nœuds à au plus `depth` liens d'un nœud (relations dans les deux sens et liens parent-enfant), " +
        'avec leur distance et les relations entre eux.',
      inputSchema: z.object({
        nodeId: id.describe('Nœud central'),
        depth: z.number().int().min(1).max(4).default(1),
        maxNodes: maxRows.describe(
          `Nombre maximal de nœuds (défaut ${DEFAULT_MAX_ROWS})`,
        ),
      }),
      annotations: READ_ONLY,
    },
    run(neighborhood),
  );

  server.registerTool(
    'nodal_health',
    {
      title: 'Santé de la base',
      description:
        'Ce qui manque ou cloche dans la base : compteurs, puis une table issues (nœuds sans résumé, ' +
        'documents vides, nœuds isolés, liens [[…]] cassés, doublons probables, ajouts de l’IA à relire) ' +
        'et gaps, les recherches restées sans résultat (sujets à documenter). Pour entretenir ou enrichir la base.',
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(HEALTH_MCP_LIMIT)
          .describe('Lignes au plus par vérification'),
      }),
      annotations: READ_ONLY,
    },
    async (args): Promise<CallToolResult> => {
      try {
        // Nœuds ancrés d'abord (identifiants complets), vérifiés hors connexion.
        const check = withWorkspace(options.workspaceFile, (ctx) =>
          anchorCheck(ctx, codeRootsOf(ctx)),
        );
        const stale = check.nodes.length > 0 ? await staleOf(check) : null;
        const data = call(args, 'read', (ctx, input: typeof args) =>
          health(ctx, input, stale),
        );
        return { content: [{ type: 'text', text: encodeToon(data) }] };
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'nodal_for_files',
    {
      title: 'Nœuds des fichiers du code',
      description:
        'Nœuds ancrés à des fichiers du code (chemins absolus, ou relatifs au dossier de code), ' +
        'au format de nodal_search : chemin, résumé, fichiers concernés, puis leurs documents courts ' +
        '(dans la limite de maxChars ; les autres dans otherDocuments). notAnchored : fichiers sans nœud ; ' +
        'stale : nœuds dont des fichiers ont changé depuis leur dernière mise à jour (aussi signalés par ' +
        'nodal_search et nodal_get_node). À appeler avant de modifier ces fichiers.',
      inputSchema: z.object({
        paths: z
          .array(z.string().min(1).max(1000))
          .min(1)
          .max(100)
          .describe('Chemins des fichiers'),
        maxChars: z
          .number()
          .int()
          .min(0)
          .max(100_000)
          .default(DEFAULT_FOR_FILES_CHARS)
          .describe('Contenu de documents renvoyé au plus'),
      }),
      annotations: READ_ONLY,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const found = call(args, 'read', (ctx, input: typeof args) =>
          forFiles(ctx, input, codeRootsOf(ctx)),
        );
        const stale = await staleOf(found.check);
        return withDocuments({
          result: { ...found.result, ...staleField(stale) },
          documents: found.documents,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'nodal_path',
    {
      title: 'Chemin entre deux nœuds',
      description:
        'Plus court chemin de fromId à toId par les relations (dans les deux sens), ' +
        'en option par la hiérarchie : chaque nœud avec le lien qui y mène (→ / ← type, ↑ parent, ↓ enfant).',
      inputSchema: z.object({
        fromId: id.describe('Nœud de départ'),
        toId: id.describe("Nœud d'arrivée"),
        maxDepth: z
          .number()
          .int()
          .min(1)
          .max(PATH_MAX_DEPTH)
          .default(PATH_DEFAULT_DEPTH)
          .describe('Nombre maximal de liens'),
        includeHierarchy: z
          .boolean()
          .default(false)
          .describe('Passer aussi par les liens parent-enfant'),
      }),
      annotations: READ_ONLY,
    },
    run(findPath),
  );

  if (options.readOnly) return server;

  /** Exécute une écriture (une transaction, journalisée) et encode son résultat. */
  const write =
    <A>(change: (ctx: WriteContext, args: A) => unknown) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        const client = server.server.getClientVersion()?.name ?? null;
        const data = call(args, 'write', (ctx, resolved) =>
          change(
            {
              ...ctx,
              client,
              codeRoots: codeRootsOf(ctx),
            },
            resolved,
          ),
        );
        return { content: [{ type: 'text', text: encodeToon(data) }] };
      } catch (error) {
        return failure(error);
      }
    };

  server.registerTool(
    'nodal_create_node',
    {
      title: 'Créer un nœud',
      description:
        'Crée un nœud (sous parentId, ou à la racine), avec un résumé et des tags facultatifs ' +
        '(créés s’ils n’existent pas). Refusé si un nœud de même titre existe déjà au même endroit. ' +
        'Types : concept (notion, idée), component (élément d’un système), data (donnée, schéma), ' +
        'procedure (marche à suivre), resource (référence externe), generic.',
      inputSchema: z.object({
        title: z.string().min(1).max(200),
        type: nodeType,
        parentId: id.nullable().optional().describe('Parent (absent : racine)'),
        summary: z
          .string()
          .max(2000)
          .optional()
          .describe('Une ou deux phrases'),
        tags: tagNames.optional(),
        allowDuplicate: z.boolean().optional(),
        template: z
          .string()
          .max(100)
          .optional()
          .describe(
            'Modèle de document à ajouter (nom, ex. « Procédure », « Décision (ADR) »)',
          ),
      }),
      annotations: ADDITIVE,
    },
    write(createNode),
  );

  server.registerTool(
    'nodal_update_node',
    {
      title: 'Modifier un nœud',
      description:
        'Change le titre, le type, le résumé (null pour l’effacer) ou le parent (null : racine) d’un nœud. ' +
        'Seuls les champs fournis sont modifiés.',
      inputSchema: z.object({
        id,
        title: z.string().min(1).max(200).optional(),
        type: nodeType.optional(),
        summary: z.string().max(2000).nullable().optional(),
        parentId: id.nullable().optional(),
      }),
      annotations: OVERWRITING,
    },
    write(updateNode),
  );

  server.registerTool(
    'nodal_add_document',
    {
      title: 'Ajouter un document',
      description:
        'Attache un document à un nœud : markdown (notes, explications), text, json, code ' +
        '(avec language, ex. typescript, python, sql) ou mermaid (diagramme). ' +
        'Dans un document markdown, [[Titre]] ou [[Titre]](id) crée un lien interne et une relation « est lié à ».',
      inputSchema: z.object({
        nodeId: id,
        title: z.string().min(1).max(200),
        contentType: z.enum(CONTENT_TYPES),
        language: z.string().max(50).nullable().optional(),
        body: z.string(),
      }),
      annotations: ADDITIVE,
    },
    write(addDocument),
  );

  server.registerTool(
    'nodal_update_document',
    {
      title: 'Modifier un document',
      description:
        'Modifie le titre et/ou le contenu d’un document. mode append (défaut) ajoute body à la fin, ' +
        'mode replace remplace tout le contenu : relisez-le d’abord (nodal_read_document).',
      inputSchema: z.object({
        id,
        title: z.string().min(1).max(200).optional(),
        body: z.string().optional(),
        mode: z.enum(['append', 'replace']).default('append'),
      }),
      annotations: OVERWRITING,
    },
    write(updateDocument),
  );

  server.registerTool(
    'nodal_link',
    {
      title: 'Relier deux nœuds',
      description:
        'Crée une relation orientée source → cible avec un type de relation existant (voir nodal_overview), ' +
        'désigné par son nom. createRelationType: true crée le type s’il manque (à éviter si un type existant convient).',
      inputSchema: z.object({
        sourceId: id,
        targetId: id,
        relation: z.string().min(1).max(100),
        label: z.string().max(200).optional(),
        description: z.string().max(2000).optional(),
        createRelationType: z.boolean().optional(),
      }),
      annotations: ADDITIVE,
    },
    write(link),
  );

  server.registerTool(
    'nodal_tag',
    {
      title: 'Étiqueter un nœud',
      description:
        'Ajoute et/ou retire des tags d’un nœud, par nom. Les tags ajoutés qui n’existent pas sont créés.',
      inputSchema: z.object({
        nodeId: id,
        add: tagNames.optional(),
        remove: tagNames.optional(),
      }),
      annotations: OVERWRITING,
    },
    write(tagNode),
  );

  server.registerTool(
    'nodal_apply',
    {
      title: 'Écriture groupée',
      description:
        'Applique dans l’ordre une liste d’opérations, en une seule transaction (tout ou rien) : ' +
        'createNode, updateNode, addDocument, updateDocument, link, tag — mêmes champs que les outils ' +
        'unitaires, plus op — et anchor (nodeId, add/remove : fichiers du code, chemins ou motifs glob ' +
        'comme src/mcp/**, à ancrer au nœud). Un identifiant peut être une référence $n à l’élément créé ou modifié par ' +
        'la n-ième opération (ex. nodeId: "$1"). Renvoie l’identifiant de chaque élément touché. ' +
        'À préférer dès qu’il y a plusieurs choses à enregistrer.',
      inputSchema: z.object({
        operations: z
          .array(operationSchema)
          .min(1)
          .max(APPLY_MAX_OPERATIONS)
          .describe('Opérations, exécutées dans l’ordre'),
      }),
      annotations: OVERWRITING,
    },
    write((ctx, args: { operations: Operation[] }) =>
      applyOperations(ctx, args.operations, loadShortIds(ctx)),
    ),
  );

  return server;
}
