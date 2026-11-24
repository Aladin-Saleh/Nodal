/**
 * Comparaison de l'espace ouvert avec une sauvegarde du même espace : ce qui
 * a été ajouté, retiré ou modifié depuis, par identifiant. La sauvegarde est
 * lue telle quelle, jamais migrée ni modifiée.
 */
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { NodalError } from '../../shared/errors';
import type {
  ComparisonEntry,
  DocumentChange,
  NodeChange,
  WorkspaceComparison,
} from '../../shared/model';
import { NODAL_APPLICATION_ID, getApplicationId } from '../database/connection';
import type { ServiceContext } from './context';
import { asRows } from './rows';

/** Lignes renvoyées au plus par rubrique (les compteurs restent exacts). */
export const COMPARISON_LIMIT = 200;

interface NodeState {
  id: string;
  title: string;
  type: string;
  summary: string | null;
  parentId: string | null;
}
interface DocumentState {
  id: string;
  nodeId: string;
  title: string;
  body: string;
}
interface EdgeState {
  key: string;
  sourceId: string;
  targetId: string;
  relation: string;
}
interface State {
  nodes: Map<string, NodeState>;
  documents: Map<string, DocumentState>;
  edges: Map<string, EdgeState>;
}

/** Colonnes présentes depuis le premier schéma seulement. */
function readState(db: DatabaseSync, workspaceId: string): State {
  const nodes = asRows<NodeState>(
    db
      .prepare(
        `SELECT id, title, node_type AS type, summary, parent_id AS parentId
         FROM node WHERE workspace_id = ? ORDER BY rowid`,
      )
      .all(workspaceId),
  );
  const documents = asRows<DocumentState>(
    db
      .prepare(
        `SELECT d.id, d.node_id AS nodeId, d.title, d.body
         FROM document d JOIN node n ON n.id = d.node_id
         WHERE n.workspace_id = ? ORDER BY d.rowid`,
      )
      .all(workspaceId),
  );
  const edges = asRows<Omit<EdgeState, 'key'>>(
    db
      .prepare(
        `SELECT e.source_node_id AS sourceId, e.target_node_id AS targetId,
           rt.name AS relation
         FROM edge e JOIN relation_type rt ON rt.id = e.relation_type_id
         WHERE e.workspace_id = ? ORDER BY e.rowid`,
      )
      .all(workspaceId),
  ).map((edge) => ({
    ...edge,
    // Par extrémités et type : une relation recréée à l'identique n'a pas changé.
    key: `${edge.sourceId}|${edge.relation.toLowerCase()}|${edge.targetId}`,
  }));
  return {
    nodes: new Map(nodes.map((node) => [node.id, node])),
    documents: new Map(documents.map((doc) => [doc.id, doc])),
    edges: new Map(edges.map((edge) => [edge.key, edge])),
  };
}

function readBackup(file: string, workspaceId: string): State {
  if (!fs.existsSync(file)) {
    throw new NodalError(
      'FILE_NOT_FOUND',
      `Le fichier « ${file} » est introuvable.`,
    );
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (cause) {
    throw new NodalError(
      'INVALID_WORKSPACE_FILE',
      `Impossible de lire « ${file} ».`,
      { cause },
    );
  }
  try {
    db.exec('PRAGMA trusted_schema = OFF');
    let known = false;
    try {
      known = getApplicationId(db) === NODAL_APPLICATION_ID;
    } catch {
      // Pas une base SQLite.
    }
    if (!known) {
      throw new NodalError(
        'NOT_A_NODAL_FILE',
        "Ce fichier n'est pas un espace Nodal.",
      );
    }
    const same = db
      .prepare('SELECT 1 FROM workspace WHERE id = ?')
      .get(workspaceId);
    if (!same) {
      throw new NodalError(
        'VALIDATION_ERROR',
        'Ce fichier est un autre espace : choisissez une sauvegarde de celui-ci.',
      );
    }
    return readState(db, workspaceId);
  } finally {
    db.close();
  }
}

const list = <T>(items: readonly T[]) => ({
  count: items.length,
  items: items.slice(0, COMPARISON_LIMIT),
});

/** Différences depuis la sauvegarde `file` (avant) jusqu'à l'espace ouvert. */
export function compareWithBackup(
  ctx: ServiceContext,
  file: string,
): WorkspaceComparison {
  const before = readBackup(file, ctx.workspaceId);
  const after = readState(ctx.db, ctx.workspaceId);
  const titleOf = (id: string | null) =>
    id === null
      ? 'la racine'
      : `« ${(after.nodes.get(id) ?? before.nodes.get(id))?.title ?? '?'} »`;
  const entry = (node: NodeState): ComparisonEntry => ({
    nodeId: after.nodes.has(node.id) ? node.id : null,
    title: node.title,
    detail: `dans ${titleOf(node.parentId)}`,
  });

  const added: ComparisonEntry[] = [];
  const modified: NodeChange[] = [];
  for (const node of after.nodes.values()) {
    const old = before.nodes.get(node.id);
    if (!old) {
      added.push(entry(node));
      continue;
    }
    const changes: string[] = [];
    if (old.title !== node.title)
      changes.push(`titre : « ${old.title} » → « ${node.title} »`);
    if (old.type !== node.type)
      changes.push(`type : ${old.type} → ${node.type}`);
    if ((old.summary ?? '') !== (node.summary ?? '')) changes.push('résumé');
    if (old.parentId !== node.parentId)
      changes.push(
        `déplacé de ${titleOf(old.parentId)} à ${titleOf(node.parentId)}`,
      );
    if (changes.length > 0)
      modified.push({ nodeId: node.id, title: node.title, changes });
  }
  const removed = [...before.nodes.values()]
    .filter((node) => !after.nodes.has(node.id))
    .map(entry);

  const documents: DocumentChange[] = [];
  const document = (
    doc: DocumentState,
    change: DocumentChange['change'],
    chars: number,
  ): DocumentChange => ({
    nodeId: after.nodes.has(doc.nodeId) ? doc.nodeId : null,
    nodeTitle:
      (after.nodes.get(doc.nodeId) ?? before.nodes.get(doc.nodeId))?.title ??
      '?',
    title: doc.title,
    change,
    chars,
  });
  for (const doc of after.documents.values()) {
    const old = before.documents.get(doc.id);
    if (!old) documents.push(document(doc, 'added', doc.body.length));
    else if (old.body !== doc.body || old.title !== doc.title)
      documents.push(
        document(doc, 'modified', doc.body.length - old.body.length),
      );
    else if (old.nodeId !== doc.nodeId)
      documents.push(document(doc, 'moved', 0));
  }
  for (const doc of before.documents.values()) {
    if (!after.documents.has(doc.id))
      documents.push(document(doc, 'removed', -doc.body.length));
  }

  const relation = (edge: EdgeState): ComparisonEntry => ({
    nodeId: after.nodes.has(edge.sourceId) ? edge.sourceId : null,
    title: `${titleOf(edge.sourceId)} ${edge.relation} ${titleOf(edge.targetId)}`,
    detail: '',
  });
  return {
    added: list(added),
    removed: list(removed),
    modified: list(modified),
    documents: list(documents),
    relationsAdded: list(
      [...after.edges.values()]
        .filter((edge) => !before.edges.has(edge.key))
        .map(relation),
    ),
    relationsRemoved: list(
      [...before.edges.values()]
        .filter((edge) => !after.edges.has(edge.key))
        .map(relation),
    ),
  };
}
