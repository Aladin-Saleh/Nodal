import type { NodeType } from '../../shared/domain';
import { pendingAssistantNodeIds } from './assistant-origin';
import type { GraphData, GraphNode, NodePosition } from '../../shared/model';
import { inTransaction } from '../database/transaction';
import type { ContextProvider } from './context';
import { listEdges } from './edge-service';
import { listRelationTypes } from './relation-type-service';
import { asRows } from './rows';

interface GraphNodeRow {
  id: string;
  parent_id: string | null;
  title: string;
  node_type: NodeType;
  color: string | null;
  position_x: number | null;
  position_y: number | null;
  position_z: number | null;
}

/**
 * Vue graphe (§6.8, §13) : une seule vue par espace, positions stockées sur
 * les nœuds. Seules des métadonnées légères sont chargées, jamais le contenu
 * des documents.
 */
export class GraphService {
  constructor(private readonly context: ContextProvider) {}

  get(): GraphData {
    const ctx = this.context();
    const tagsByNode = new Map<string, string[]>();
    for (const { node_id, tag_id } of asRows<{
      node_id: string;
      tag_id: string;
    }>(
      ctx.db
        .prepare(
          `SELECT nt.node_id, nt.tag_id FROM node_tag nt
           JOIN node n ON n.id = nt.node_id WHERE n.workspace_id = ?`,
        )
        .all(ctx.workspaceId),
    )) {
      const list = tagsByNode.get(node_id);
      if (list) list.push(tag_id);
      else tagsByNode.set(node_id, [tag_id]);
    }

    const pending = pendingAssistantNodeIds(ctx);
    const nodes: GraphNode[] = asRows<GraphNodeRow>(
      ctx.db
        .prepare(
          `SELECT id, parent_id, title, node_type, color, position_x, position_y, position_z
           FROM node WHERE workspace_id = ? ORDER BY sort_order, rowid`,
        )
        .all(ctx.workspaceId),
    ).map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      title: row.title,
      nodeType: row.node_type,
      color: row.color,
      x: row.position_x,
      y: row.position_y,
      z: row.position_z,
      tagIds: tagsByNode.get(row.id) ?? [],
      assistantPending: pending.has(row.id),
    }));

    return {
      nodes,
      edges: listEdges(ctx),
      relationTypes: listRelationTypes(ctx),
    };
  }

  /** Enregistre les coordonnées d'affichage ; ignore les nœuds inconnus. */
  savePositions(positions: NodePosition[]): void {
    const ctx = this.context();
    const update = ctx.db.prepare(
      'UPDATE node SET position_x = ?, position_y = ?, position_z = ? WHERE id = ? AND workspace_id = ?',
    );
    inTransaction(ctx.db, () => {
      for (const { id, x, y, z } of positions) {
        update.run(x, y, z, id, ctx.workspaceId);
      }
    });
  }
}
