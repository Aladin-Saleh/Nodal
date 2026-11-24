/**
 * Impact : nœuds à revoir si un nœud change, par les relations parcourues
 * dans le sens de la dépendance. Logique pure, partagée par l'application et
 * le serveur MCP.
 */
import type { PathGraphEdge, PathGraphNode } from './graph-path';
import { foldText } from './text';

export const IMPACT_DEFAULT_DEPTH = 2;
export const IMPACT_MAX_DEPTH = 8;

/**
 * Qui est touché quand l'autre extrémité change : la source (« A dépend de
 * B » : B change, A est touché), la cible (« A alimente B »), ou personne
 * (lien vague, ou type propre à l'espace dont le sens n'est pas connu).
 */
export type ImpactDirection = 'source' | 'target' | 'none';

const DIRECTIONS: ReadonlyMap<string, ImpactDirection> = new Map([
  ...[
    'dépend de',
    'utilise',
    'implémente',
    'consomme',
    'décrit',
    'depends on',
    'uses',
    'implements',
    'consumes',
    'describes',
  ].map((name) => [foldText(name), 'source'] as const),
  ...['alimente', 'feeds'].map((name) => [foldText(name), 'target'] as const),
]);

export const impactDirection = (relationName: string): ImpactDirection =>
  DIRECTIONS.get(foldText(relationName).trim()) ?? 'none';

/** Relation qui dit seulement que deux nœuds ont à voir. */
export const isVagueRelation = (relationName: string): boolean =>
  ['est lie a', 'related to'].includes(foldText(relationName).trim());

export interface ImpactHit {
  nodeId: string;
  depth: number;
  /** Relation par laquelle il est atteint, et nœud qu'elle relie. */
  edgeId: string;
  relationTypeId: string;
  fromId: string;
}

/**
 * Nœuds touchés si `seeds` changent, les plus proches d'abord. Les
 * descendants des points de départ en font partie (un composant, c'est aussi
 * ses parties) sans être listés. `directionOf` : sens de chaque type.
 */
export function impactOf(
  nodes: readonly PathGraphNode[],
  edges: readonly PathGraphEdge[],
  seeds: readonly string[],
  directionOf: (relationTypeId: string) => ImpactDirection,
  maxDepth = IMPACT_DEFAULT_DEPTH,
): ImpactHit[] {
  const known = new Set(nodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  for (const { id, parentId } of nodes) {
    if (parentId === null) continue;
    const list = children.get(parentId);
    if (list) list.push(id);
    else children.set(parentId, [id]);
  }
  // Nœud qui change → nœuds touchés.
  const affected = new Map<string, { to: string; edge: PathGraphEdge }[]>();
  for (const edge of edges) {
    if (!known.has(edge.sourceId) || !known.has(edge.targetId)) continue;
    const direction = directionOf(edge.relationTypeId);
    if (direction === 'none') continue;
    const [from, to] =
      direction === 'source'
        ? [edge.targetId, edge.sourceId]
        : [edge.sourceId, edge.targetId];
    const item = { to, edge };
    const list = affected.get(from);
    if (list) list.push(item);
    else affected.set(from, [item]);
  }

  const seen = new Set<string>();
  const start: string[] = [];
  const pending = seeds.filter((id) => known.has(id));
  while (pending.length > 0) {
    const id = pending.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    start.push(id);
    pending.push(...(children.get(id) ?? []));
  }
  const hits: ImpactHit[] = [];
  let frontier = start;
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const { to, edge } of affected.get(id) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        hits.push({
          nodeId: to,
          depth,
          edgeId: edge.id,
          relationTypeId: edge.relationTypeId,
          fromId: id,
        });
        next.push(to);
      }
    }
    frontier = next;
  }
  return hits;
}
