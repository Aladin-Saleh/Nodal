/** Lecture du graphe pour l'analyse (shared/graph-analysis.ts). */
import type { AnalysisEdge, AnalysisGraph } from '../../shared/graph-analysis';
import { assistantCreations } from './assistant-origin';
import type { ServiceContext } from './context';
import { asRows } from './rows';

export function readAnalysisGraph(ctx: ServiceContext): AnalysisGraph {
  const nodes = asRows<{
    id: string;
    title: string;
    type: string;
    parentId: string | null;
  }>(
    ctx.db
      .prepare(
        `SELECT id, title, node_type AS type, parent_id AS parentId
         FROM node WHERE workspace_id = ? ORDER BY rowid`,
      )
      .all(ctx.workspaceId),
  );
  const edges = asRows<
    Omit<AnalysisEdge, 'detailed' | 'fromLink' | 'pending'> & {
      label: string | null;
      description: string | null;
      from_link: number;
      pending: string | null;
    }
  >(
    ctx.db
      .prepare(
        `SELECT e.id, e.source_node_id AS sourceId, e.target_node_id AS targetId,
           rt.name AS relation, e.label, e.description, e.from_link,
           origin.entity_id AS pending
         FROM edge e JOIN relation_type rt ON rt.id = e.relation_type_id
         LEFT JOIN ${assistantCreations('link')} origin ON origin.entity_id = e.id
         WHERE e.workspace_id = ? ORDER BY e.rowid`,
      )
      .all(ctx.workspaceId),
  ).map(({ label, description, from_link, pending, ...edge }) => ({
    ...edge,
    detailed: Boolean(label?.trim() || description?.trim()),
    fromLink: from_link === 1,
    pending: pending !== null,
  }));
  return { nodes, edges };
}
