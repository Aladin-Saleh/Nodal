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
  readDocument,
  search,
  tree,
} from './tools';
import { loadShortIds, resolveIds, shortenIds } from './short-ids';
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

const READ_INSTRUCTIONS = `Base de connaissances Nodal : une hiérarchie de nœuds typés,
des documents attachés aux nœuds (markdown, texte, json, code, mermaid) et des
relations transversales nommées entre nœuds.

Les réponses sont au format TOON : \`clé: valeur\` pour un objet, et pour une
liste homogène \`nom[N]{champ1,champ2}:\` suivi d'une ligne par élément.

Les identifiants sont abrégés (préfixe d'UUID) : réutilisez-les tels quels
comme arguments des autres outils.

Provenance : createdBy (nœud) et by (relation) valent "user" pour ce que
l'utilisateur a saisi, "assistant" pour ce qu'un assistant IA a ajouté — à
considérer comme moins sûr tant que l'utilisateur ne l'a pas validé.

Consultez cette base avant de parcourir des fichiers ou de répondre de
mémoire. Commencez par nodal_search : il renvoie le résumé des nœuds trouvés
et le contenu des documents trouvés, ce qui suffit souvent pour répondre.
Pour une question à plusieurs volets, lancez plusieurs nodal_search en
parallèle, dans le même message. Pour approfondir : nodal_get_node (documents,
enfants, relations d'un nœud), nodal_read_document, nodal_tree et
nodal_neighborhood. nodal_overview sert à s'orienter quand la question est
vague.`;

const WRITE_INSTRUCTIONS = `

Cette base est partagée avec son utilisateur : enrichissez-la pour mémoriser
ce que vous apprenez. Avant de créer un nœud, cherchez s'il existe déjà
(nodal_search) et complétez-le plutôt que de le dupliquer. Rangez chaque nœud
sous le bon parent, résumez-le en une ou deux phrases, mettez le détail dans
des documents (nodal_add_document, ou nodal_update_document en mode append
pour compléter) et reliez les notions entre elles (nodal_link) avec les types
de relations existants. Rien n'est supprimé : chaque modification est
journalisée et l'utilisateur peut l'annuler depuis Nodal.`;

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
}

/**
 * Document trouvé par la recherche : une ligne d'en-tête, puis le contenu
 * brut (hors TOON, pour ne pas l'échapper).
 */
function formatFoundDocument(doc: FoundDocument): string {
  const kind = doc.language
    ? `${doc.contentType}, ${doc.language}`
    : doc.contentType;
  const header = `--- document ${doc.id} « ${doc.title} » (${kind}) · ${doc.path}`;
  const rest =
    doc.nextOffset === null
      ? ''
      : `\n[… tronqué : suite avec nodal_read_document id=${doc.id} offset=${doc.nextOffset}]`;
  return `${header}\n${doc.body}${rest}`;
}

function failure(error: unknown): CallToolResult {
  const message =
    error instanceof NodalError
      ? error.message
      : `Erreur interne : ${error instanceof Error ? error.message : String(error)}`;
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function createNodalMcpServer(
  options: NodalMcpServerOptions,
): McpServer {
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
        return shortenIds(result, loadShortIds(ctx)) as R;
      },
      mode,
    );

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
        'à utiliser en premier. Renvoie les nœuds trouvés (chemin, résumé) puis le contenu des ' +
        'documents trouvés, du plus pertinent au moins pertinent, dans la limite de maxChars ; ' +
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
        const { result, documents } = call(args, 'read', search);
        return {
          content: [
            { type: 'text', text: encodeToon(result) },
            ...documents.map((doc) => ({
              type: 'text' as const,
              text: formatFoundDocument(doc),
            })),
          ],
        };
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
        'Un nœud avec son chemin, son résumé et ses tags, la liste de ses documents (sans leur contenu), ' +
        'ses enfants directs, ses relations entrantes et sortantes et ses pièces jointes.',
      inputSchema: z.object({ id: id.describe('Identifiant du nœud') }),
      annotations: READ_ONLY,
    },
    run((ctx, args: { id: string }) => getNode(ctx, args.id)),
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

  if (options.readOnly) return server;

  /** Exécute une écriture (une transaction, journalisée) et encode son résultat. */
  const write =
    <A>(change: (ctx: WriteContext, args: A) => unknown) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        const client = server.server.getClientVersion()?.name ?? null;
        const data = call(args, 'write', (ctx, resolved) =>
          change({ ...ctx, client }, resolved),
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
        'Dans un document markdown, [[Titre d’un nœud]] crée un lien interne.',
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

  return server;
}
