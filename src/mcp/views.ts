/**
 * Vues graphe vues par un assistant : il les décrit (nodal_overview) et les
 * crée ou les complète (nodal_apply, op `view`) avec les mêmes réglages
 * qu'un utilisateur dans le graphe — types et tags affichés, œil (masquer,
 * branche seule), replis, types de relations masqués, hiérarchie. Il ne les
 * ouvre jamais : l'utilisateur choisit la vue dans le menu « Vues ▾ ».
 */
import type { NodeType } from '../shared/domain';
import { NodalError } from '../shared/errors';
import {
  graphViewNameSchema,
  graphViewSettingsSchema,
} from '../shared/ipc-schemas';
import type { GraphViewSettings } from '../shared/model';
import {
  recordAssistantChange,
  readNodeState,
  type ViewState,
} from '../main/knowledge/assistant-change-service';
import { notFound } from '../main/knowledge/context';
import { GraphViewService } from '../main/knowledge/graph-view-service';
import { listRelationTypes } from '../main/knowledge/relation-type-service';
import { TagService } from '../main/knowledge/tag-service';
import type { ReadContext } from './workspace-reader';
import { check, type WriteContext } from './write-tools';

/** Nœuds cités par leur titre dans la description d'une vue, au plus. */
const TITLES_SHOWN = 5;

/** Réglages d'une vue neuve : ceux d'un graphe sans filtre. */
const defaultSettings = (): GraphViewSettings =>
  graphViewSettingsSchema.parse({
    scope: null,
    depth: 2,
    nodeTypes: [],
    tagIds: [],
    hiddenRelationTypeIds: [],
    showHierarchy: true,
    collapsed: [],
  });

function titleOf(ctx: ReadContext, id: string): string | null {
  return readNodeState(ctx, id)?.title ?? null;
}

function titles(ctx: ReadContext, ids: readonly string[]): string {
  const known = ids.flatMap((id) => titleOf(ctx, id) ?? []);
  const extra = known.length - TITLES_SHOWN;
  return (
    known.slice(0, TITLES_SHOWN).join(', ') + (extra > 0 ? ` (+${extra})` : '')
  );
}

const named = (ids: readonly string[], names: Map<string, string>) =>
  ids.flatMap((id) => names.get(id) ?? []).join(', ');

/** Ce que montre une vue, en une ligne (« tout » : aucun réglage). */
export function describeView(
  ctx: ReadContext,
  settings: GraphViewSettings,
): string {
  const tagNames = new Map(
    new TagService(() => ctx).list().map((tag) => [tag.id, tag.name]),
  );
  const relationNames = new Map(
    listRelationTypes(ctx).map((type) => [type.id, type.name]),
  );
  const parts = [
    settings.nodeTypes.length > 0 && `types : ${settings.nodeTypes.join(', ')}`,
    settings.tagIds.length > 0 && `tags : ${named(settings.tagIds, tagNames)}`,
    settings.solo && `branche seule : ${titleOf(ctx, settings.solo) ?? '?'}`,
    settings.hidden.length > 0 && `masqués : ${titles(ctx, settings.hidden)}`,
    settings.collapsed.length > 0 &&
      `repliés : ${titles(ctx, settings.collapsed)}`,
    settings.hiddenRelationTypeIds.length > 0 &&
      `relations masquées : ${named(settings.hiddenRelationTypeIds, relationNames)}`,
    !settings.showHierarchy && 'sans hiérarchie',
    settings.assistantPendingOnly && 'ajouts de l’IA à valider seulement',
  ].filter(Boolean);
  return parts.join(' ; ') || 'tout';
}

export function listViews(ctx: ReadContext) {
  return new GraphViewService(() => ctx).list().map((view) => ({
    name: view.name,
    shows: describeView(ctx, view.settings),
  }));
}

const quoted = (text: string) => `« ${text} »`;

/** Identifiants des noms donnés (sans casse) ; un nom inconnu est refusé. */
function idsByName(
  what: string,
  known: readonly { id: string; name: string }[],
  names: readonly string[],
): string[] {
  const byName = new Map(
    known.map((item) => [item.name.toLowerCase(), item.id]),
  );
  return names.map((name) => {
    const id = byName.get(name.trim().toLowerCase());
    if (id) return id;
    throw new NodalError(
      'NOT_FOUND',
      `${what} ${quoted(name)} inconnu. Existants : ${known.map((item) => item.name).join(', ') || 'aucun'}.`,
    );
  });
}

function requireNodes(ctx: ReadContext, ids: readonly string[]): void {
  for (const id of ids) if (!readNodeState(ctx, id)) throw notFound('Nœud');
}

const without = (list: readonly string[], removed: readonly string[]) =>
  list.filter((id) => !removed.includes(id));

/**
 * Crée la vue de ce nom, ou complète celle qui existe : `types`, `tags` et
 * `hideRelations` remplacent la liste de la vue ; `hide` / `show` et
 * `collapse` / `expand` ajoutent ou retirent des nœuds ; les champs absents
 * ne changent rien.
 */
export function saveView(
  ctx: WriteContext,
  input: {
    name: string;
    types?: NodeType[];
    tags?: string[];
    hide?: string[];
    show?: string[];
    solo?: string | null;
    collapse?: string[];
    expand?: string[];
    hideRelations?: string[];
    hierarchy?: boolean;
  },
) {
  const name = check(graphViewNameSchema, input.name);
  const views = new GraphViewService(() => ctx);
  const existing = views.findByName(name);
  const base = existing?.settings ?? defaultSettings();
  const nodeIds = [
    ...(input.hide ?? []),
    ...(input.show ?? []),
    ...(input.collapse ?? []),
    ...(input.expand ?? []),
    ...(input.solo ? [input.solo] : []),
  ];
  requireNodes(ctx, nodeIds);
  const settings = graphViewSettingsSchema.parse({
    ...base,
    ...(input.types && { nodeTypes: [...new Set(input.types)] }),
    ...(input.tags && {
      tagIds: idsByName('Tag', new TagService(() => ctx).list(), input.tags),
    }),
    ...(input.hideRelations && {
      hiddenRelationTypeIds: idsByName(
        'Type de relation',
        listRelationTypes(ctx),
        input.hideRelations,
      ),
    }),
    ...(input.hierarchy !== undefined && { showHierarchy: input.hierarchy }),
    ...(input.solo !== undefined && { solo: input.solo }),
    hidden: [
      ...new Set([
        ...without(base.hidden, input.show ?? []),
        ...(input.hide ?? []),
      ]),
    ],
    collapsed: [
      ...new Set([
        ...without(base.collapsed, input.expand ?? []),
        ...(input.collapse ?? []),
      ]),
    ],
  });
  const after: ViewState = { name: existing?.name ?? name, settings };
  const shows = describeView(ctx, settings);
  if (!existing) {
    const created = views.create({ name, settings, camera: null });
    recordAssistantChange(ctx, {
      action: 'create_view',
      nodeId: created.id,
      entityId: created.id,
      summary: `Vue créée : ${quoted(name)} (${shows})`,
      client: ctx.client,
      before: null,
      after,
    });
    return { id: created.id, shows };
  }
  const before: ViewState = {
    name: existing.name,
    settings: existing.settings,
  };
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    views.update({ id: existing.id, settings });
    recordAssistantChange(ctx, {
      action: 'update_view',
      nodeId: existing.id,
      entityId: existing.id,
      summary: `Vue modifiée : ${quoted(existing.name)} (${shows})`,
      client: ctx.client,
      before,
      after,
    });
  }
  return { id: existing.id, shows };
}
