/** Schéma Mermaid d'une branche, gardé comme document du nœud. */
import {
  branchSchema,
  SCHEMA_MARKER,
  type SchemaNode,
} from '../../shared/mermaid-schema';
import { inTransaction } from '../database/transaction';
import { notFound, type ServiceContext } from './context';
import { DocumentService } from './document-service';
import { listEdges } from './edge-service';
import { listRelationTypes } from './relation-type-service';
import { asRow, asRows } from './rows';

/**
 * Crée le schéma du nœud, ou remplace celui que Nodal avait généré ; un
 * document dont la première ligne a été retirée est à l'utilisateur, et n'est
 * plus touché. Renvoie le document et ce qui n'a pas tenu dans le schéma.
 */
export function writeBranchSchema(
  ctx: ServiceContext,
  nodeId: string,
): { documentId: string; omittedNodes: number; omittedEdges: number } {
  const { db, workspaceId } = ctx;
  const nodes = asRows<SchemaNode>(
    db
      .prepare(
        `SELECT id, title, parent_id AS parentId FROM node
         WHERE workspace_id = ? ORDER BY sort_order, rowid`,
      )
      .all(workspaceId),
  );
  if (!nodes.some((node) => node.id === nodeId)) throw notFound('Nœud');
  const typeName = new Map(
    listRelationTypes(ctx).map((type) => [type.id, type.name]),
  );
  const schema = branchSchema(
    nodes,
    listEdges(ctx).map((edge) => ({
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      text: edge.label ?? typeName.get(edge.relationTypeId) ?? '',
      ...(edge.confidence && { confidence: edge.confidence }),
    })),
    nodeId,
  );
  return inTransaction(db, () => {
    const documents = new DocumentService(() => ctx);
    const existing = asRow<{ id: string }>(
      db
        .prepare(
          `SELECT id FROM document WHERE node_id = ? AND content_type = 'mermaid'
             AND substr(body, 1, ?) = ? ORDER BY sort_order LIMIT 1`,
        )
        .get(nodeId, SCHEMA_MARKER.length, SCHEMA_MARKER),
    );
    const documentId =
      existing?.id ??
      documents.create({ nodeId, title: 'Schéma', contentType: 'mermaid' }).id;
    documents.update({ id: documentId, body: schema.source });
    // Généré : ce n'est pas une mise à jour de la documentation du code.
    db.prepare(
      `UPDATE document SET updated_at = (SELECT updated_at FROM node WHERE id = ?)
       WHERE id = ?`,
    ).run(nodeId, documentId);
    return {
      documentId,
      omittedNodes: schema.omittedNodes,
      omittedEdges: schema.omittedEdges,
    };
  });
}
