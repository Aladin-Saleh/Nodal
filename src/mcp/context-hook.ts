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
 */
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
  readContextSession,
  writeContextSession,
  type ContextSession,
} from './context-session';
import { formatFoundDocument } from './server';
import { loadShortIds, shortenIds } from './short-ids';
import { normalize, search, termPatterns } from './tools';
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

/** Mots-clés d'une demande : sans accents, ni mots courants, ni mots de 1-2 lettres. */
export function promptKeywords(prompt: string): string[] {
  const words = normalize(prompt).match(/[\p{L}\p{N}_]+/gu) ?? [];
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

/** Retire les nœuds déjà donnés dans la session ; note ceux qui le sont. */
function withoutSent(
  ctx: ReadContext,
  hits: SearchHit[],
  session: ContextSession,
): SearchHit[] {
  const versionOf = ctx.db.prepare(
    `SELECT max(n.updated_at, coalesce((SELECT max(d.updated_at)
       FROM document d WHERE d.node_id = n.id), '')) AS version
     FROM node n WHERE n.id = ?`,
  );
  return hits.filter((hit) => {
    const [row] = asRows<{ version: string }>([versionOf.get(hit.nodeId)]);
    const version = row?.version ?? '';
    const full = hit.matches.length > 0;
    if (alreadySent(session, hit.nodeId, version, full)) return false;
    session.sent[hit.nodeId] = { version, full, prompt: session.prompt };
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
): string | null {
  if (prompt.trimStart().startsWith('/')) return null;
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
      return session ? withoutSent(ctx, chosen, session) : chosen;
    },
  );
  if (found.result.nodes.length === 0) return null;

  const ids = loadShortIds(ctx);
  let resolver: LinkResolver | null = null;
  const readable = renderResponseLinks(found, (text) => {
    if (!text.includes('[[')) return text;
    resolver ??= workspaceLinkResolver(ctx);
    return renderLinksForLlm(text, resolver, ids);
  });
  const { result, documents } = shortenIds(readable, ids) as typeof found;
  // La requête est rappelée en clair dans l'en-tête.
  const { query: _query, ...rest } = result;
  return [
    '<nodal-context>',
    `Base Nodal « ${ctx.workspace.name} » : extraits trouvés automatiquement pour cette demande (mots : ${keywords.join(', ')}). ` +
      'Partez-en ; approfondissez avec nodal_get_node / nodal_read_document, ou nodal_search si ce n’est pas le bon sujet.',
    redactSecrets(encodeToon(rest)),
    ...documents.map((doc) => redactSecrets(formatFoundDocument(doc))),
    '</nodal-context>',
  ].join('\n\n');
}

/** Entrée du hook (champs communs à Claude Code et Gemini CLI). */
interface HookInput {
  prompt?: unknown;
  hook_event_name?: unknown;
  session_id?: unknown;
}

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
    const prompt = input.prompt;
    if (typeof prompt !== 'string') return '';
    const file =
      typeof input.session_id === 'string' && input.session_id
        ? contextSessionFile(input.session_id, workspaceFile)
        : null;
    const session = file ? readContextSession(file) : null;
    if (session) session.prompt++;
    const context = withWorkspace(workspaceFile, (ctx) =>
      promptContext(ctx, prompt, maxChars, session),
    );
    if (file && session) writeContextSession(file, session);
    if (!context) return '';
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName:
          typeof input.hook_event_name === 'string'
            ? input.hook_event_name
            : 'UserPromptSubmit',
        additionalContext: context,
      },
    });
  } catch {
    return '';
  }
}
