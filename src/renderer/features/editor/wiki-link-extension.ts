/**
 * Liens [[...]] dans l'éditeur Markdown (CodeMirror) :
 * - `[[` ouvre une autocomplétion des nœuds (titre et chemin, correspondance
 *   approximative) ; le choix insère `[[node:<id>]]`, lien qui survit aux
 *   renommages ;
 * - un lien par identifiant s'affiche par le titre courant du nœud (ou son
 *   texte `[[node:<id>|texte]]`), en un bloc qui s'efface d'un coup ; un lien
 *   qui ne mène à aucun nœud est signalé.
 */
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { formatNodeLink, type LinkResolver } from '../../../shared/wiki-links';
import { fuzzyScore, queryTerms } from '../commands/fuzzy';
import type { LinkNode, NodeLinks } from './node-links';

/** Propositions affichées au plus. */
const COMPLETION_LIMIT = 30;

export interface WikiLinkSource {
  nodes(): readonly LinkNode[];
  resolver(): LinkResolver;
}

/**
 * Nœuds de l'espace tenus à jour hors de React : l'éditeur, créé une seule
 * fois, les lit au moment de proposer ou d'afficher un lien.
 */
export class LiveNodeLinks implements WikiLinkSource {
  constructor(private links: NodeLinks) {}

  set(links: NodeLinks): void {
    this.links = links;
  }

  get(): NodeLinks {
    return this.links;
  }

  nodes(): readonly LinkNode[] {
    return this.links.nodes;
  }

  resolver(): LinkResolver {
    return this.links.resolver;
  }
}

/** Nœuds correspondant au texte tapé après `[[`, du meilleur au moins bon. */
export function linkCompletions(
  query: string,
  nodes: readonly LinkNode[],
): LinkNode[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return nodes.slice(0, COMPLETION_LIMIT);
  const scored: { node: LinkNode; score: number }[] = [];
  for (const node of nodes) {
    const byTitle = fuzzyScore(terms, node.title);
    const score =
      byTitle ??
      (node.path ? fuzzyScore(terms, `${node.path} ${node.title}`) : null);
    if (score !== null) {
      scored.push({ node, score: byTitle === null ? score - 50 : score });
    }
  }
  return scored
    .toSorted((a, b) => b.score - a.score)
    .slice(0, COMPLETION_LIMIT)
    .map(({ node }) => node);
}

function completionSource(source: WikiLinkSource) {
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/\[\[[^[\]\n|]*$/);
    if (!before) return null;
    const query = before.text.slice(2);
    const options: Completion[] = linkCompletions(query, source.nodes()).map(
      (node) => ({
        label: node.title,
        detail: node.path || undefined,
        type: 'text',
        apply: (view, _completion, from, to) => {
          // Les `]]` déjà tapés (ou ajoutés par l'éditeur) sont remplacés.
          const after = view.state.sliceDoc(to, to + 2);
          const end = after === ']]' ? to + 2 : to;
          const link = formatNodeLink(node.id);
          view.dispatch({
            changes: { from, to: end, insert: link },
            selection: { anchor: from + link.length },
          });
        },
      }),
    );
    return { from: before.from, to: context.pos, options, filter: false };
  };
}

class LinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly broken: boolean,
  ) {
    super();
  }

  override eq(other: LinkWidget): boolean {
    return other.label === this.label && other.broken === this.broken;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = this.broken ? 'cm-node-link broken' : 'cm-node-link';
    // Texte seulement : aucun HTML venant du contenu.
    span.textContent = this.label;
    if (this.broken) span.title = 'Lien cassé : ce nœud n’existe plus';
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

const ID_LINK =
  /\[\[node:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|([^[\]\n]+))?\]\]/gi;

function linkDecorations(source: WikiLinkSource) {
  const matcher = new MatchDecorator({
    regexp: ID_LINK,
    decoration: (match) => {
      const title = source.resolver().titleOf(match[1]!.toLowerCase());
      const label = match[2]?.trim() || title || 'lien cassé';
      return Decoration.replace({
        widget: new LinkWidget(label, title === undefined),
      });
    },
  });
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = matcher.createDeco(view);
      }
      update(update: ViewUpdate) {
        this.decorations = matcher.updateDeco(update, this.decorations);
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      // Le lien s'efface et se traverse d'un bloc.
      provide: (plugin) =>
        EditorView.atomicRanges.of(
          (view) => view.plugin(plugin)?.decorations ?? Decoration.none,
        ),
    },
  );
}

/** Extension pour les documents Markdown. */
export function wikiLinkExtension(source: WikiLinkSource): Extension {
  return [
    EditorState.languageData.of(() => [
      { autocomplete: completionSource(source) },
    ]),
    linkDecorations(source),
  ];
}
