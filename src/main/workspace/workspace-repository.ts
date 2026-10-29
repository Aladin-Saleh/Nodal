import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_RELATION_TYPES } from '../../shared/domain';

export interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelationTypeRow {
  id: string;
  workspace_id: string;
  name: string;
  color: string | null;
  is_builtin: number;
}

export function insertWorkspace(db: DatabaseSync, row: WorkspaceRow): void {
  db.prepare(
    `INSERT INTO workspace (id, name, description, created_at, updated_at)
     VALUES (:id, :name, :description, :created_at, :updated_at)`,
  ).run({ ...row });
}

export function insertDefaultRelationTypes(
  db: DatabaseSync,
  workspaceId: string,
  generateId: () => string,
): void {
  const insert = db.prepare(
    `INSERT INTO relation_type (id, workspace_id, name, color, is_builtin)
     VALUES (?, ?, ?, NULL, 1)`,
  );
  for (const name of DEFAULT_RELATION_TYPES) {
    insert.run(generateId(), workspaceId, name);
  }
}

export function listWorkspaces(db: DatabaseSync): WorkspaceRow[] {
  return db
    .prepare(
      `SELECT id, name, description, created_at, updated_at
       FROM workspace ORDER BY created_at`,
    )
    .all() as unknown as WorkspaceRow[];
}

export function listRelationTypes(
  db: DatabaseSync,
  workspaceId: string,
): RelationTypeRow[] {
  return db
    .prepare(
      `SELECT id, workspace_id, name, color, is_builtin
       FROM relation_type WHERE workspace_id = ? ORDER BY rowid`,
    )
    .all(workspaceId) as unknown as RelationTypeRow[];
}
