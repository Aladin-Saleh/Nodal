/**
 * Analyse du graphe : relations superflues, cycles de dépendance, connexions
 * entre branches, nœuds charnières et questions que tout cela suggère.
 * Logique pure ; la lecture de la base est dans analysis-service.ts.
 */
import { impactDirection, isVagueRelation } from './graph-impact';

export interface AnalysisNode {
  id: string;
  title: string;
  type: string;
  parentId: string | null;
}

export interface AnalysisEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  /** Libellé ou description : la relation dit quelque chose de plus. */
  detailed: boolean;
  /** Créée par un lien [[…]] : elle suit le lien. */
  fromLink: boolean;
  /** Ajoutée par un assistant, pas encore validée. */
  pending: boolean;
}

export interface AnalysisGraph {
  nodes: readonly AnalysisNode[];
  edges: readonly AnalysisEdge[];
}

/** Nœuds au plus pour le calcul des charnières (proportionnel à N × E). */
const BRIDGES_MAX_NODES = 2_000;
/** Cycle le plus long signalé. */
const CYCLE_MAX_LENGTH = 5;

const index = <T extends { id: string }>(items: readonly T[]) =>
  new Map(items.map((item) => [item.id, item]));

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Ancêtres d'un nœud, de la racine à lui-même. */
function lineage(byId: ReadonlyMap<string, AnalysisNode>, id: string) {
  const path: string[] = [];
  for (
    let current = byId.get(id);
    current && !path.includes(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined
  ) {
    path.unshift(current.id);
  }
  return path;
}

export interface RedundantRelation {
  edge: AnalysisEdge;
  reason: 'duplicate' | 'hierarchy' | 'implied';
  /** Implicite : nœuds intermédiaires. */
  through: string[];
}

/**
 * Relations qui n'apprennent rien de plus : lien vague en plus d'une relation
 * précise, ou entre un parent et son enfant ; « dépend de » déjà impliqué par
 * une chaîne de « dépend de ». Une relation libellée, ou issue d'un lien
 * [[…]], n'est jamais signalée.
 */
export function redundantRelations({
  nodes,
  edges,
}: AnalysisGraph): RedundantRelation[] {
  const byId = index(nodes);
  const pair = (edge: AnalysisEdge) =>
    [edge.sourceId, edge.targetId].toSorted().join('|');
  const byPair = new Map<string, AnalysisEdge[]>();
  for (const edge of edges) push(byPair, pair(edge), edge);
  // Chaîne : seulement du même type, le seul qui se transmette à coup sûr.
  const isDependency = (edge: AnalysisEdge) =>
    /^(?:dépend de|depends on)$/i.test(edge.relation);
  const depends = new Map<string, string[]>();
  for (const edge of edges)
    if (isDependency(edge)) push(depends, edge.sourceId, edge.targetId);

  const found: RedundantRelation[] = [];
  for (const edge of edges) {
    if (edge.detailed || edge.fromLink || edge.sourceId === edge.targetId)
      continue;
    const source = byId.get(edge.sourceId);
    const target = byId.get(edge.targetId);
    if (!source || !target) continue;
    if (isVagueRelation(edge.relation)) {
      const others = byPair.get(pair(edge))!;
      // Deux liens vagues : le second est superflu.
      const first = others.find((other) => isVagueRelation(other.relation));
      if (
        first !== edge ||
        others.some((other) => !isVagueRelation(other.relation))
      ) {
        found.push({ edge, reason: 'duplicate', through: [] });
      } else if (
        source.parentId === target.id ||
        target.parentId === source.id
      ) {
        found.push({ edge, reason: 'hierarchy', through: [] });
      }
      continue;
    }
    if (!isDependency(edge)) continue;
    const through = chain(depends, edge.sourceId, edge.targetId);
    if (through) found.push({ edge, reason: 'implied', through });
  }
  return found;
}

/** Plus courte chaîne de deux liens au moins ; les nœuds intermédiaires. */
function chain(
  next: ReadonlyMap<string, string[]>,
  from: string,
  to: string,
): string[] | null {
  const previous = new Map<string, string>();
  let frontier = (next.get(from) ?? []).filter((id) => id !== to);
  for (const id of frontier) previous.set(id, from);
  while (frontier.length > 0) {
    const following: string[] = [];
    for (const id of frontier) {
      for (const target of next.get(id) ?? []) {
        if (target === to) {
          const path = [id];
          while (previous.get(path[0]!) !== from)
            path.unshift(previous.get(path[0]!)!);
          return path;
        }
        if (target === from || previous.has(target)) continue;
        previous.set(target, id);
        following.push(target);
      }
    }
    frontier = following;
  }
  return null;
}

/**
 * Cycles de dépendance (« A dépend de B », « B alimente… »), du plus court au
 * plus long ; un seul par groupe de nœuds, borné à CYCLE_MAX_LENGTH.
 */
export function dependencyCycles({ nodes, edges }: AnalysisGraph): string[][] {
  const known = new Set(nodes.map((node) => node.id));
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    const direction = impactDirection(edge.relation);
    if (direction === 'none' || edge.sourceId === edge.targetId) continue;
    // « décrit » ne crée pas de dépendance réciproque gênante.
    if (/^(?:décrit|describes)$/i.test(edge.relation)) continue;
    if (!known.has(edge.sourceId) || !known.has(edge.targetId)) continue;
    const [from, to] =
      direction === 'source'
        ? [edge.sourceId, edge.targetId]
        : [edge.targetId, edge.sourceId];
    push(next, from, to);
  }
  const cycles = new Map<string, string[]>();
  for (const start of next.keys()) {
    // Plus court cycle passant par ce nœud (parcours en largeur).
    const previous = new Map<string, string>();
    let frontier = [start];
    let last: string | null = null;
    for (
      let length = 1;
      length <= CYCLE_MAX_LENGTH && frontier.length > 0 && last === null;
      length++
    ) {
      const following: string[] = [];
      for (const id of frontier) {
        for (const target of next.get(id) ?? []) {
          if (target === start) {
            last ??= id;
          } else if (!previous.has(target)) {
            previous.set(target, id);
            following.push(target);
          }
        }
      }
      frontier = following;
    }
    if (last === null) continue;
    const cycle = [last];
    while (cycle[0] !== start) cycle.unshift(previous.get(cycle[0]!)!);
    const key = cycle.toSorted().join('|');
    if (!cycles.has(key)) cycles.set(key, cycle);
  }
  return [...cycles.values()].toSorted((a, b) => a.length - b.length);
}

export interface Bridge {
  nodeId: string;
  /** Part des plus courts chemins qui passent par lui (0 à 1). */
  score: number;
}

/**
 * Nœuds charnières : ceux par lesquels passent le plus de plus courts chemins
 * entre les autres (algorithme de Brandes, sur les relations, sans sens).
 */
export function bridges({ nodes, edges }: AnalysisGraph): Bridge[] {
  const neighbors = new Map<string, Set<string>>();
  const known = new Set(nodes.map((node) => node.id));
  for (const { sourceId: a, targetId: b } of edges) {
    if (a === b || !known.has(a) || !known.has(b)) continue;
    neighbors.set(a, (neighbors.get(a) ?? new Set()).add(b));
    neighbors.set(b, (neighbors.get(b) ?? new Set()).add(a));
  }
  const ids = [...neighbors.keys()];
  if (ids.length < 3 || ids.length > BRIDGES_MAX_NODES) return [];
  const scores = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const source of ids) {
    const distance = new Map([[source, 0]]);
    const paths = new Map([[source, 1]]);
    const previous = new Map<string, string[]>();
    const order = [source];
    for (const id of order) {
      const next = distance.get(id)! + 1;
      for (const other of neighbors.get(id)!) {
        if (!distance.has(other)) {
          distance.set(other, next);
          order.push(other);
        }
        if (distance.get(other) !== next) continue;
        paths.set(other, (paths.get(other) ?? 0) + paths.get(id)!);
        push(previous, other, id);
      }
    }
    const share = new Map<string, number>();
    for (const id of order.toReversed()) {
      const own = share.get(id) ?? 0;
      for (const before of previous.get(id) ?? []) {
        share.set(
          before,
          (share.get(before) ?? 0) +
            (paths.get(before)! / paths.get(id)!) * (1 + own),
        );
      }
      if (id !== source) scores.set(id, scores.get(id)! + own);
    }
  }
  const pairs = (ids.length - 1) * (ids.length - 2);
  return ids
    .map((nodeId) => ({ nodeId, score: scores.get(nodeId)! / pairs }))
    .filter((item) => item.score > 0)
    .toSorted((a, b) => b.score - a.score);
}

export interface Connection {
  edge: AnalysisEdge;
  score: number;
  reasons: string[];
}

/**
 * Relations entre branches éloignées, les plus inattendues d'abord : une
 * seule par paire de branches, pour qu'un nœud très relié ne les prenne pas
 * toutes.
 */
export function connections({ nodes, edges }: AnalysisGraph): Connection[] {
  const byId = index(nodes);
  const degree = new Map<string, number>();
  for (const { sourceId, targetId } of edges) {
    degree.set(sourceId, (degree.get(sourceId) ?? 0) + 1);
    degree.set(targetId, (degree.get(targetId) ?? 0) + 1);
  }
  const found: (Connection & { pair: string })[] = [];
  for (const edge of edges) {
    const a = lineage(byId, edge.sourceId);
    const b = lineage(byId, edge.targetId);
    if (a.length === 0 || b.length === 0) continue;
    let common = 0;
    while (common < a.length && a[common] === b[common]) common++;
    // Un ancêtre et son descendant : même branche.
    if (common === a.length || common === b.length) continue;
    const distance = a.length + b.length - 2 * common;
    // Frères : reliés par leur parent, rien d'inattendu.
    if (distance <= 2) continue;
    const reasons = [`${distance} niveaux d’écart dans l’arborescence`];
    let score = distance;
    if (byId.get(edge.sourceId)!.type !== byId.get(edge.targetId)!.type) {
      score += 1;
      reasons.push('types de nœuds différents');
    }
    if (edge.pending) {
      score += 1;
      reasons.push('ajoutée par l’IA, non validée');
    }
    const ends = [
      degree.get(edge.sourceId) ?? 0,
      degree.get(edge.targetId) ?? 0,
    ];
    if (Math.min(...ends) <= 2 && Math.max(...ends) >= 5) {
      score += 1;
      reasons.push('nœud peu relié vers un nœud central');
    }
    found.push({
      edge,
      score,
      reasons,
      pair: [a[common]!, b[common]!].toSorted().join('|'),
    });
  }
  const seen = new Set<string>();
  return found
    .toSorted((a, b) => b.score - a.score)
    .filter(({ pair }) => !seen.has(pair) && seen.add(pair))
    .map(({ pair: _pair, ...item }) => item);
}

export interface Question {
  kind: 'bridge' | 'pending' | 'vague' | 'isolated';
  question: string;
  why: string;
  /** Nœuds concernés. */
  nodeIds: string[];
}

/**
 * Questions à se poser sur la base, types entrelacés : un signal abondant
 * n'écarte pas les autres.
 */
export function suggestedQuestions(
  graph: AnalysisGraph,
  limit = 7,
): Question[] {
  const { nodes, edges } = graph;
  const byId = index(nodes);
  const title = (id: string) => `« ${byId.get(id)?.title ?? '?'} »`;
  const around = new Map<string, AnalysisEdge[]>();
  for (const edge of edges) {
    push(around, edge.sourceId, edge);
    if (edge.targetId !== edge.sourceId) push(around, edge.targetId, edge);
  }
  const branchOf = (id: string) => {
    const path = lineage(byId, id);
    return path.at(-2) ?? null;
  };

  const groups: Question[][] = [
    bridges(graph)
      .slice(0, 3)
      .flatMap(({ nodeId, score }) => {
        const own = branchOf(nodeId);
        const others = new Set(
          (around.get(nodeId) ?? []).map((edge) =>
            branchOf(edge.sourceId === nodeId ? edge.targetId : edge.sourceId),
          ),
        );
        others.delete(own);
        // Ni lui-même, ni un de ses ancêtres.
        for (const id of lineage(byId, nodeId)) others.delete(id);
        const branches = [...others].filter((id) => id !== null);
        if (branches.length === 0) return [];
        return [
          {
            kind: 'bridge' as const,
            question: `Pourquoi ${title(nodeId)} relie-t-il ${branches.slice(0, 3).map(title).join(', ')} au reste ?`,
            why: `${Math.round(score * 100)} % des plus courts chemins passent par lui.`,
            nodeIds: [nodeId, ...branches.slice(0, 3)],
          },
        ];
      }),
    [...around]
      .map(([id, list]) => ({
        id,
        pending: list.filter((edge) => edge.pending),
      }))
      .filter(({ pending }) => pending.length >= 2)
      .toSorted((a, b) => b.pending.length - a.pending.length)
      .slice(0, 3)
      .map(({ id, pending }) => {
        const others = [
          ...new Set(
            pending.map((edge) =>
              edge.sourceId === id ? edge.targetId : edge.sourceId,
            ),
          ),
        ].slice(0, 2);
        return {
          kind: 'pending' as const,
          question: `Les ${pending.length} relations ajoutées par l’IA autour de ${title(id)} (avec ${others.map(title).join(', ')}) sont-elles justes ?`,
          why: 'Ajoutées par l’IA, pas encore validées.',
          nodeIds: [id, ...others],
        };
      }),
    edges
      .filter(
        (edge) =>
          isVagueRelation(edge.relation) && !edge.detailed && !edge.fromLink,
      )
      .slice(0, 3)
      .map((edge) => ({
        kind: 'vague' as const,
        question: `Quel est le lien exact entre ${title(edge.sourceId)} et ${title(edge.targetId)} ?`,
        why: `Relation « ${edge.relation} », sans précision.`,
        nodeIds: [edge.sourceId, edge.targetId],
      })),
  ];
  const parents = new Set(nodes.map((node) => node.parentId));
  const isolated = nodes.filter(
    (node) =>
      node.parentId !== null && !parents.has(node.id) && !around.has(node.id),
  );
  if (isolated.length > 0) {
    const shown = isolated.slice(0, 3).map((node) => node.id);
    groups.push([
      {
        kind: 'isolated',
        question: `Qu’est-ce qui relie ${shown.map(title).join(', ')} au reste ?`,
        why:
          isolated.length === 1
            ? '1 nœud sans relation.'
            : `${isolated.length} nœuds sans relation.`,
        nodeIds: shown,
      },
    ]);
  }
  const questions: Question[] = [];
  for (let rank = 0; questions.length < limit; rank++) {
    const row = groups.flatMap((group) => group[rank] ?? []);
    if (row.length === 0) break;
    questions.push(...row);
  }
  return questions.slice(0, limit);
}
