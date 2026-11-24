/**
 * Schéma Mermaid d'une branche : ses nœuds les plus reliés, groupés par
 * sous-branche, et leurs relations. Volontairement petit : ce qui n'y tient
 * pas est compté, jamais tassé. Logique pure, déterministe.
 */
import type { Confidence } from './evidence';

export const SCHEMA_MAX_NODES = 18;
export const SCHEMA_MAX_EDGES = 24;
const LABEL_MAX_LENGTH = 50;

/** Première ligne d'un schéma généré : il peut être remplacé sans demander. */
export const SCHEMA_MARKER = '%% Schéma généré par Nodal';

export interface SchemaNode {
  id: string;
  title: string;
  parentId: string | null;
}

export interface SchemaEdge {
  sourceId: string;
  targetId: string;
  /** Libellé de la relation, sinon nom de son type. */
  text: string;
  confidence?: Confidence;
}

export interface BranchSchema {
  source: string;
  omittedNodes: number;
  omittedEdges: number;
}

/** Texte sûr entre guillemets : les caractères de syntaxe sont codés. */
function label(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const short =
    flat.length > LABEL_MAX_LENGTH
      ? `${flat.slice(0, LABEL_MAX_LENGTH - 1)}…`
      : flat;
  return short.replace(
    /["#<>&`|{}[\]\\;]/g,
    (char) => `#${char.codePointAt(0)};`,
  );
}

export function branchSchema(
  nodes: readonly SchemaNode[],
  edges: readonly SchemaEdge[],
  rootId: string,
): BranchSchema {
  const children = new Map<string, SchemaNode[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const list = children.get(node.parentId);
    if (list) list.push(node);
    else children.set(node.parentId, [node]);
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = byId.get(rootId);
  // Branche, du plus proche au plus lointain.
  const branch: { node: SchemaNode; depth: number; group: string | null }[] =
    [];
  const seen = new Set<string>();
  if (root) branch.push({ node: root, depth: 0, group: null });
  for (const { node, depth, group } of branch) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    for (const child of children.get(node.id) ?? []) {
      if (seen.has(child.id)) continue;
      branch.push({
        node: child,
        depth: depth + 1,
        group: group ?? child.id,
      });
    }
  }
  const inside = edges.filter(
    (edge) =>
      edge.sourceId !== edge.targetId &&
      seen.has(edge.sourceId) &&
      seen.has(edge.targetId),
  );
  const degree = new Map<string, number>();
  for (const { sourceId, targetId } of inside)
    for (const id of [sourceId, targetId])
      degree.set(id, (degree.get(id) ?? 0) + 1);

  // La racine porte le titre du document : elle n'apparaît que si elle est
  // reliée, ou s'il n'y a que la hiérarchie à montrer.
  const candidates = branch.filter(
    ({ node, depth }) =>
      depth > 0 || degree.has(node.id) || inside.length === 0,
  );
  const chosen = candidates
    .toSorted(
      (a, b) =>
        (degree.get(b.node.id) ?? 0) - (degree.get(a.node.id) ?? 0) ||
        a.depth - b.depth,
    )
    .slice(0, SCHEMA_MAX_NODES);
  const kept = new Set(chosen.map(({ node }) => node.id));
  const drawn = inside.filter(
    (edge) => kept.has(edge.sourceId) && kept.has(edge.targetId),
  );
  const shown = drawn.slice(0, SCHEMA_MAX_EDGES);
  const omittedNodes = candidates.length - chosen.length;
  const omittedEdges = inside.length - shown.length;

  // Ordre de la branche : le schéma ne change pas sans raison.
  const ordered = candidates.filter(({ node }) => kept.has(node.id));
  const names = new Map(
    ordered.map(({ node }, index) => [node.id, `n${index + 1}`]),
  );
  const groups = new Map<string | null, SchemaNode[]>();
  for (const { node, group } of ordered) {
    const list = groups.get(group);
    if (list) list.push(node);
    else groups.set(group, [node]);
  }
  const lines = [SCHEMA_MARKER, 'flowchart LR'];
  const draw = (node: SchemaNode, indent: string) =>
    lines.push(`${indent}${names.get(node.id)}["${label(node.title)}"]`);
  let groupIndex = 0;
  for (const [group, members] of groups) {
    if (group === null || members.length < 2) {
      for (const node of members) draw(node, '  ');
      continue;
    }
    lines.push(
      `  subgraph g${++groupIndex}["${label(byId.get(group)!.title)}"]`,
    );
    for (const node of members) draw(node, '    ');
    lines.push('  end');
  }
  for (const edge of shown) {
    const arrow = edge.confidence === 'uncertain' ? '-.->' : '-->';
    lines.push(
      `  ${names.get(edge.sourceId)} ${arrow}|"${label(edge.text)}"| ${names.get(edge.targetId)}`,
    );
  }
  if (inside.length === 0) {
    // Rien que la hiérarchie à montrer.
    for (const { node } of ordered) {
      const parent = node.parentId ? names.get(node.parentId) : undefined;
      if (parent) lines.push(`  ${parent} --- ${names.get(node.id)}`);
    }
  }
  if (omittedNodes > 0 || omittedEdges > 0) {
    lines.push(
      `%% Non montrés : ${omittedNodes} nœuds, ${omittedEdges} relations`,
    );
  }
  return { source: `${lines.join('\n')}\n`, omittedNodes, omittedEdges };
}
