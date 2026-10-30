import type { NodeSummary } from '../../../shared/model';

export interface TreeIndex {
  byId: Map<string, NodeSummary>;
  /** Enfants triés par ordre ; la clé `null` contient les racines. */
  children: Map<string | null, NodeSummary[]>;
}

export interface VisibleRow {
  node: NodeSummary;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export function buildTreeIndex(nodes: readonly NodeSummary[]): TreeIndex {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string | null, NodeSummary[]>();
  for (const node of nodes) {
    // Un parent inconnu (ne devrait pas arriver) : le nœud est affiché à la racine.
    const key =
      node.parentId !== null && byId.has(node.parentId) ? node.parentId : null;
    const list = children.get(key);
    if (list) list.push(node);
    else children.set(key, [node]);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return { byId, children };
}

/** Lignes visibles de l'arborescence selon les nœuds dépliés. */
export function visibleRows(
  index: TreeIndex,
  expanded: ReadonlySet<string>,
): VisibleRow[] {
  const result: VisibleRow[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const node of index.children.get(parentId) ?? []) {
      const hasChildren = (index.children.get(node.id)?.length ?? 0) > 0;
      const isExpanded = hasChildren && expanded.has(node.id);
      result.push({ node, depth, hasChildren, expanded: isExpanded });
      if (isExpanded) visit(node.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

/** Le nœud et tous ses descendants (cibles interdites pour un déplacement). */
export function subtreeIds(index: TreeIndex, id: string): Set<string> {
  const result = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    for (const child of index.children.get(current) ?? []) stack.push(child.id);
  }
  return result;
}

/** Ancêtres d'un nœud, du parent à la racine. */
export function ancestorIds(index: TreeIndex, id: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current = index.byId.get(id)?.parentId ?? null;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    result.push(current);
    current = index.byId.get(current)?.parentId ?? null;
  }
  return result;
}

export function siblingsOf(index: TreeIndex, node: NodeSummary): NodeSummary[] {
  const key =
    node.parentId !== null && index.byId.has(node.parentId)
      ? node.parentId
      : null;
  return index.children.get(key) ?? [];
}

/** Place d'un dépôt par rapport à la ligne survolée. */
export type DropPosition = 'before' | 'after' | 'inside';

/** Déplacement demandé à node:move (index parmi les frères, nœud déplacé exclu). */
export interface DropMove {
  parentId: string | null;
  /** Absent : en dernier. */
  index?: number;
}

/**
 * Déplacement correspondant au dépôt de `draggedId` avant, après ou dans
 * `targetId` ; `null` si la cible est interdite (le nœud lui-même ou l'un de
 * ses descendants : ce serait un cycle) ou si rien ne changerait.
 */
export function dropMove(
  index: TreeIndex,
  draggedId: string,
  targetId: string,
  position: DropPosition,
): DropMove | null {
  const dragged = index.byId.get(draggedId);
  const target = index.byId.get(targetId);
  if (!dragged || !target || subtreeIds(index, draggedId).has(targetId)) {
    return null;
  }
  if (position === 'inside') {
    return dragged.parentId === targetId ? null : { parentId: targetId };
  }
  const parentId = target.parentId;
  const siblings = siblingsOf(index, target).filter(
    (node) => node.id !== draggedId,
  );
  const targetIndex = siblings.findIndex((node) => node.id === targetId);
  const newIndex = position === 'before' ? targetIndex : targetIndex + 1;
  if (dragged.parentId === parentId) {
    const current = siblingsOf(index, dragged).findIndex(
      (node) => node.id === draggedId,
    );
    if (current === newIndex) return null;
  }
  return { parentId, index: newIndex };
}
