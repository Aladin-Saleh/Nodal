/**
 * Contexte automatique : avant chaque demande, l'assistant (hook
 * `UserPromptSubmit` de Claude Code, `BeforeAgent` de Gemini CLI) lance
 *
 *   node nodal-mcp.cjs <fichier.nodal> --context
 *
 * avec la demande en JSON sur stdin. Nodal y cherche les mots-clés de la
 * demande et renvoie les nœuds et documents pertinents, ajoutés au contexte
 * du tour : l'assistant les a sans qu'on lui dise de consulter Nodal. Rien
 * n'est écrit dans la base (pas de « sujet à documenter »), et une erreur ne
 * bloque jamais la demande : la sortie est alors vide.
 *
 * Deux niveaux, pour qu'une demande sans rapport coûte peu : un nœud dont le
 * titre et le résumé contiennent plusieurs mots-clés vient avec ses documents,
 * un nœud trouvé surtout par ses documents vient avec son résumé. Un nœud
 * déjà donné dans la session n'est pas répété (context-session.ts).
 *
 * La même commande sert deux autres hooks de Claude Code : `PreToolUse`
 * (rappel des nœuds d'un fichier, file-hook.ts) et `SessionStart` après un
 * résumé du contexte (ce qui a été donné peut l'être à nouveau).
 */
import fs from 'node:fs';
import path from 'node:path';
import { encode as encodeToon } from '@toon-format/toon';
import { asRows } from '../main/knowledge/rows';
import { workspaceLinkResolver } from '../main/knowledge/link-service';
import type { SearchHit } from '../shared/model';
import { redactSecrets } from '../shared/secrets';
import type { LinkResolver } from '../shared/wiki-links';
import { renderLinksForLlm, renderResponseLinks } from './links';
import {
  alreadySent,
  contextSessionFile,
  forgetContextSession,
  readContextSession,
  writeContextSession,
  type ContextSession,
} from './context-session';
import { fileNodes, toolFiles } from './file-hook';
import { formatFoundDocument } from './server';
import { loadShortIds, shortenIds } from './short-ids';
import { listLessons } from '../main/knowledge/lesson-service';
import { currentLessons, type Lesson } from '../shared/lessons';
import {
  codeRootsFor,
  lessonOverlap,
  lessonRows,
  LESSONS_LIMIT,
  normalize,
  search,
  termPatterns,
  type FoundDocument,
} from './tools';
import { withWorkspace, type ReadContext } from './workspace-reader';

/** Contenu de documents ajouté au plus (≈ 1 000 tokens). */
export const CONTEXT_MAX_CHARS = 4_000;
/** Nœuds retenus au plus. */
export const CONTEXT_MAX_NODES = 5;
/** Mots-clés gardés de la demande. */
const MAX_KEYWORDS = 8;

/** Mots trop courants pour désigner un sujet (français, anglais), sans accents. */
const STOP_WORDS = new Set(
  (
    'les des une est sont pour par avec dans sur pas plus que qui quoi quel quelle quels quelles ' +
    'comment pourquoi faire fait fais peux peut veux voudrais aimerais faut dois doit ' +
    'cette ces cet son ses leur leurs notre nos votre vos mon mes ton tes elle elles ils ' +
    'nous vous mais donc car aussi tout tous toute toutes tres bien encore deja ' +
    'alors ainsi apres avant entre sans sous chez ici etre avoir ete etait sera ' +
    'moi toi lui eux cela ceci rien autre autres meme chaque quand comme dont ' +
    'fois fini finir suite ensuite continue continuer termine super marche passe bon bonne reste depuis hier demain ' +
    'oui non merci stp svp bonjour salut voici voila ajoute ajouter regarde regarder ' +
    'explique expliquer dis dire montre montrer donne donner aide aider ' +
    'the and for with this that what which how why can could would should please ' +
    'from into about are was were been have has had does did not you your our its ' +
    'there their them they then than will shall just also make show tell give help'
  ).split(' '),
);

/**
 * Blocs ajoutés par l'assistant, pas écrits par l'utilisateur : notifications
 * de tâches, sorties de commandes locales, rappels.
 */
const HARNESS_BLOCK =
  /<(task-notification|system-reminder|nodal-context|local-command-[a-z]+|command-[a-z]+|bash-[a-z]+)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/g;
/** Balise autour d'un texte collé : seul le texte compte. */
const PASTE_TAG = /<\/?pasted_content\b[^>]*>/g;
/** Chemin absolu : `C:\dossier\fichier.ts`, `/home/x/fichier.ts`, `~/x/y`. */
const ABSOLUTE_PATH =
  /(?<![\p{L}\p{N}:/\\.])(?:[a-z]:[\\/]|~?\/(?=[^\s/]+\/))[^\s"'`<>()]*/giu;

/**
 * Texte de la demande, sans les blocs de l'assistant ; un chemin absolu n'est
 * gardé que par son dernier nom (les dossiers parents ne sont pas un sujet).
 */
export function promptText(prompt: string): string {
  return prompt
    .replace(HARNESS_BLOCK, ' ')
    .replace(PASTE_TAG, ' ')
    .replace(
      ABSOLUTE_PATH,
      (found) => found.split(/[\\/]+/).findLast(Boolean) ?? '',
    )
    .trim();
}

/** Mots-clés d'une demande : sans accents, ni mots courants, ni mots de 1-2 lettres. */
export function promptKeywords(prompt: string): string[] {
  const words = normalize(promptText(prompt)).match(/[\p{L}\p{N}_]+/gu) ?? [];
  const kept = words.filter(
    (word) => word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word),
  );
  return [...new Set(kept)].slice(0, MAX_KEYWORDS);
}

/**
 * Nœuds assez pertinents : la recherche « au moins un mot » trouve presque
 * toujours quelque chose ; on garde ceux dont le titre, le résumé ou les
 * documents contiennent au moins deux des mots-clés (un seul s'il n'y en a
 * qu'un ou deux), les plus couverts d'abord. Un nœud qui n'en a pas autant
 * dans son titre et son résumé perd ses extraits : seul son résumé est donné.
 */
function relevantHits(
  ctx: ReadContext,
  hits: SearchHit[],
  keywords: readonly string[],
): SearchHit[] {
  const patterns = termPatterns(keywords.join(' '));
  const required = keywords.length >= 3 ? 2 : 1;
  const textOf = ctx.db.prepare(
    `SELECT n.title || ' ' || coalesce(n.summary, '') AS head,
       coalesce((SELECT group_concat(d.title || ' ' || d.body, ' ')
                 FROM document d WHERE d.node_id = n.id), '') AS body
     FROM node n WHERE n.id = ?`,
  );
  return hits
    .slice(0, 30)
    .map((hit, rank) => {
      const [row] = asRows<{ head: string; body: string }>([
        textOf.get(hit.nodeId),
      ]);
      const head = normalize(row?.head ?? '');
      const body = normalize(row?.body ?? '');
      const inHead = patterns.filter((pattern) => pattern.test(head)).length;
      const coverage = patterns.filter(
        (pattern) => pattern.test(head) || pattern.test(body),
      ).length;
      return {
        hit: inHead >= required ? hit : { ...hit, matches: [] },
        rank,
        coverage,
      };
    })
    .filter((entry) => entry.coverage >= required)
    .toSorted((a, b) => b.coverage - a.coverage || a.rank - b.rank)
    .map((entry) => entry.hit);
}

/**
 * Filtre des nœuds à donner : écarte ceux déjà donnés dans la session, note
 * les autres. Sans session (identifiant absent), rien n'est écarté.
 */
function notSentYet(
  ctx: ReadContext,
  session: ContextSession | null,
): (nodeId: string, full: boolean) => boolean {
  if (!session) return () => true;
  const versionOf = ctx.db.prepare(
    `SELECT max(n.updated_at, coalesce((SELECT max(d.updated_at)
       FROM document d WHERE d.node_id = n.id), '')) AS version
     FROM node n WHERE n.id = ?`,
  );
  return (nodeId, full) => {
    const [row] = asRows<{ version: string }>([versionOf.get(nodeId)]);
    const version = row?.version ?? '';
    if (alreadySent(session, nodeId, version, full)) return false;
    session.sent[nodeId] = { version, full, prompt: session.prompt };
    return true;
  };
}

/** Bloc de contexte : introduction, données en TOON, documents. */
function contextBlock(
  ctx: ReadContext,
  intro: string,
  data: { result: object; documents: FoundDocument[] },
): string {
  const ids = loadShortIds(ctx);
  let resolver: LinkResolver | null = null;
  const readable = renderResponseLinks(data, (text) => {
    if (!text.includes('[[')) return text;
    resolver ??= workspaceLinkResolver(ctx);
    return renderLinksForLlm(text, resolver, ids);
  });
  const { result, documents } = shortenIds(readable, ids) as typeof data;
  return [
    '<nodal-context>',
    intro,
    redactSecrets(encodeToon(result)),
    ...documents.map((doc) => redactSecrets(formatFoundDocument(doc))),
    '</nodal-context>',
  ].join('\n\n');
}

/**
 * Impasses et corrections proches de la demande, pas encore rappelées dans la
 * session : elles en partagent au moins deux mots (un, si elle n'en a que
 * deux), qu'un nœud soit trouvé ou non.
 */
function promptLessons(
  ctx: ReadContext,
  roots: readonly string[],
  keywords: readonly string[],
  session: ContextSession | null,
): Lesson[] {
  const patterns = termPatterns(keywords.join(' '));
  const required = keywords.length >= 3 ? 2 : 1;
  const found = listLessons(
    ctx,
    roots,
    (lesson) => lessonOverlap(lesson, patterns) >= required,
  );
  return currentLessons(found)
    .filter((lesson) => lesson.outcome !== 'useful')
    .toSorted((a, b) => lessonOverlap(b, patterns) - lessonOverlap(a, patterns))
    .slice(0, LESSONS_LIMIT)
    .filter((lesson) => {
      if (!session) return true;
      const key = `lesson:${lesson.id}`;
      const version = `${lesson.createdAt}:${lesson.stale}`;
      if (alreadySent(session, key, version, true)) return false;
      session.sent[key] = { version, full: true, prompt: session.prompt };
      return true;
    });
}

/**
 * Texte à ajouter au contexte pour cette demande, ou `null` si rien de
 * pertinent (demande sans mot-clé, commande « / », aucun nœud assez proche).
 */
export function promptContext(
  ctx: ReadContext,
  prompt: string,
  maxChars = CONTEXT_MAX_CHARS,
  session: ContextSession | null = null,
  roots: readonly string[] = [],
): string | null {
  // Le chemin en tête (« /home/… ») n'est pas une commande.
  if (promptText(prompt).startsWith('/')) return null;
  const keywords = promptKeywords(prompt);
  if (keywords.length === 0) return null;
  const found = search(
    ctx,
    { query: keywords.join(' '), limit: CONTEXT_MAX_NODES, maxChars },
    (hits) => {
      // Limite avant le tri des nœuds déjà donnés : ils ne sont pas remplacés
      // par de moins pertinents.
      const chosen = relevantHits(ctx, hits, keywords).slice(
        0,
        CONTEXT_MAX_NODES,
      );
      const keep = notSentYet(ctx, session);
      return chosen.filter((hit) => keep(hit.nodeId, hit.matches.length > 0));
    },
  );
  const lessons = promptLessons(ctx, roots, keywords, session);
  if (found.result.nodes.length === 0 && lessons.length === 0) return null;

  // La requête est rappelée en clair dans l'en-tête ; le budget manquant ne
  // sert qu'à un appel d'outil.
  const { query: _query, maxCharsNeeded: _needed, ...result } = found.result;
  return contextBlock(
    ctx,
    `Base Nodal « ${ctx.workspace.name} » : extraits trouvés automatiquement pour cette demande (mots : ${keywords.join(', ')}). ` +
      'Partiels : vérifiez qu’ils couvrent toute la question, sinon complétez (nodal_read_document, nodal_search, nodal_for_files pour des fichiers, nodal_impact pour ce que touche un changement) avant de répondre.' +
      (lessons.length > 0
        ? ' lessons : pistes déjà essayées sans succès, ou réponses corrigées par l’utilisateur.'
        : ''),
    {
      result:
        lessons.length > 0
          ? { ...result, lessons: lessonRows(lessons) }
          : result,
      documents: found.documents,
    },
  );
}

/**
 * Rappel des nœuds qui documentent des fichiers (absolus), ou `null` : aucun,
 * ou déjà donnés dans la session.
 */
export function fileContext(
  ctx: ReadContext,
  workspaceFile: string,
  files: readonly string[],
  projectRoot: string | null,
  session: ContextSession | null = null,
  edit = false,
): string | null {
  const keep = notSentYet(ctx, session);
  const found = fileNodes(
    ctx,
    workspaceFile,
    files,
    projectRoot,
    (id) => keep(id, false),
    edit,
  );
  if (found.nodes.length === 0) return null;
  // « changed » seulement s'il y a quelque chose à dire.
  const outdated = found.nodes.some((node) => node.changed);
  const nodes = found.nodes.map(({ changed, ...node }) =>
    outdated ? { ...node, changed } : node,
  );
  return contextBlock(
    ctx,
    `Base Nodal « ${ctx.workspace.name} » : nœuds qui documentent ${found.files.join(', ')} (contenu : nodal_get_node).` +
      (outdated
        ? ' changed : fichiers modifiés depuis la mise à jour du nœud, qui peut être dépassé.'
        : ''),
    { result: { nodes }, documents: [] },
  );
}

/** Dépôt git du projet : dossier de code si l'espace n'en déclare aucun. */
function projectRootOf(cwd: string): string | null {
  const root = process.env.CLAUDE_PROJECT_DIR || cwd;
  return fs.existsSync(path.join(root, '.git')) ? root : null;
}

/** Entrée du hook (champs communs à Claude Code et Gemini CLI). */
interface HookInput {
  prompt?: unknown;
  hook_event_name?: unknown;
  session_id?: unknown;
  /** Claude Code : sous-agent, dont le contexte est séparé. */
  agent_id?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
  /** SessionStart : `compact` après un résumé du contexte. */
  source?: unknown;
}

/** Outils qui modifient le fichier visé. */
const EDIT_TOOLS = /^(?:Edit|MultiEdit|Write|NotebookEdit)$/;

const textOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value ? value : fallback;

/**
 * Réponse du hook pour un fichier d'espace et l'entrée JSON reçue sur stdin :
 * JSON `hookSpecificOutput.additionalContext`, compris par Claude Code et
 * Gemini CLI, ou chaîne vide (rien à ajouter, ou erreur).
 */
export function contextHookOutput(
  workspaceFile: string,
  stdin: string,
  maxChars = CONTEXT_MAX_CHARS,
): string {
  try {
    const input = JSON.parse(stdin) as HookInput;
    const event = textOr(input.hook_event_name, 'UserPromptSubmit');
    const sessionId = textOr(input.session_id, '');
    const agentId = textOr(input.agent_id, '');
    const file = sessionId
      ? contextSessionFile(
          agentId ? `${sessionId}\0${agentId}` : sessionId,
          workspaceFile,
        )
      : null;
    if (event === 'SessionStart') {
      if (file && input.source === 'compact') forgetContextSession(file);
      return '';
    }

    const isTool = event === 'PreToolUse';
    const cwd = textOr(input.cwd, process.cwd());
    const files = isTool ? toolFiles(input.tool_input, cwd) : [];
    const prompt = input.prompt;
    // Le plus souvent, un outil ne vise aucun fichier : la base n'est pas ouverte.
    if (isTool ? files.length === 0 : typeof prompt !== 'string') return '';

    const session = file ? readContextSession(file) : null;
    if (session && !isTool) session.prompt++;
    const context = withWorkspace(workspaceFile, (ctx) =>
      isTool
        ? fileContext(
            ctx,
            workspaceFile,
            files,
            projectRootOf(cwd),
            session,
            EDIT_TOOLS.test(textOr(input.tool_name, '')),
          )
        : promptContext(
            ctx,
            prompt as string,
            maxChars,
            session,
            codeRootsFor(ctx, workspaceFile, projectRootOf(cwd)),
          ),
    );
    if (file && session && (context || !isTool))
      writeContextSession(file, session);
    if (!context) return '';
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: context },
    });
  } catch {
    return '';
  }
}
