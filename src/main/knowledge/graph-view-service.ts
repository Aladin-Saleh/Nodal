import { NodalError } from '../../shared/errors';
import type {
  CreateGraphViewInput,
  UpdateGraphViewInput,
} from '../../shared/ipc-contract';
import {
  graphCameraSchema,
  graphViewSettingsSchema,
} from '../../shared/ipc-schemas';
import type { GraphViewInfo } from '../../shared/model';
import { inTransaction } from '../database/transaction';
import { notFound, type ContextProvider } from './context';

interface GraphViewRow {
  id: string;
  name: string;
  settings: string;
  camera: string | null;
  is_default: number;
  updated_at: string;
}

/** Nombre maximal de vues par espace (garde-fou). */
export const GRAPH_VIEW_LIMIT = 100;

const SELECT_VIEW =
  'SELECT id, name, settings, camera, is_default, updated_at FROM graph_view';

/** JSON relu et validé ; `null` s'il est illisible (fichier retouché). */
function parseJson<S extends { safeParse(value: unknown): unknown }>(
  text: string | null,
  schema: S,
) {
  if (text === null) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text)) as
      | { success: true; data: unknown }
      | { success: false };
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Vues graphe nommées d'un espace (table graph_view, migration 006).
 * Affichage seulement : ni dans la recherche, ni dans l'export ; un assistant
 * en crée et en modifie par nodal_apply (op `view`), sans jamais les ouvrir.
 * Une vue illisible est ignorée plutôt que de bloquer la liste.
 */
export class GraphViewService {
  constructor(private readonly context: ContextProvider) {}

  list(): GraphViewInfo[] {
    const ctx = this.context();
    const rows = ctx.db
      .prepare(
        `${SELECT_VIEW} WHERE workspace_id = ? ORDER BY sort_order, created_at, name`,
      )
      .all(ctx.workspaceId) as unknown as GraphViewRow[];
    return rows.flatMap((row) => {
      const view = toInfo(row);
      return view ? [view] : [];
    });
  }

  create(input: CreateGraphViewInput): GraphViewInfo {
    const ctx = this.context();
    return inTransaction(ctx.db, () => {
      const { count } = ctx.db
        .prepare(
          'SELECT count(*) AS count FROM graph_view WHERE workspace_id = ?',
        )
        .get(ctx.workspaceId) as { count: number };
      if (count >= GRAPH_VIEW_LIMIT) {
        throw new NodalError(
          'LIMIT_EXCEEDED',
          `Un espace ne peut pas avoir plus de ${GRAPH_VIEW_LIMIT} vues.`,
        );
      }
      this.assertNameFree(input.name, null);
      const id = ctx.newId();
      const now = ctx.now();
      ctx.db
        .prepare(
          `INSERT INTO graph_view (id, workspace_id, name, settings, camera, is_default, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          id,
          ctx.workspaceId,
          input.name,
          JSON.stringify(graphViewSettingsSchema.parse(input.settings)),
          cameraJson(input.camera),
          count,
          now,
          now,
        );
      return this.get(id);
    });
  }

  /** Renomme et / ou remplace réglages et caméra (champs absents : inchangés). */
  update(input: UpdateGraphViewInput): GraphViewInfo {
    const ctx = this.context();
    return inTransaction(ctx.db, () => {
      this.get(input.id);
      const sets: string[] = [];
      const values: (string | null)[] = [];
      if (input.name !== undefined) {
        this.assertNameFree(input.name, input.id);
        sets.push('name = ?');
        values.push(input.name);
      }
      if (input.settings !== undefined) {
        sets.push('settings = ?');
        values.push(
          JSON.stringify(graphViewSettingsSchema.parse(input.settings)),
        );
      }
      if (input.camera !== undefined) {
        sets.push('camera = ?');
        values.push(cameraJson(input.camera));
      }
      sets.push('updated_at = ?');
      values.push(ctx.now());
      ctx.db
        .prepare(
          `UPDATE graph_view SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
        )
        .run(...values, input.id, ctx.workspaceId);
      return this.get(input.id);
    });
  }

  delete(id: string): void {
    const ctx = this.context();
    const result = ctx.db
      .prepare('DELETE FROM graph_view WHERE id = ? AND workspace_id = ?')
      .run(id, ctx.workspaceId);
    if (result.changes === 0) throw notFound('La vue');
  }

  /** Vue ouverte avec l'espace ; `null` : aucune (dernière session reprise). */
  setDefault(id: string | null): void {
    const ctx = this.context();
    inTransaction(ctx.db, () => {
      if (id !== null) this.get(id);
      ctx.db
        .prepare(
          'UPDATE graph_view SET is_default = 0 WHERE workspace_id = ? AND is_default = 1',
        )
        .run(ctx.workspaceId);
      if (id !== null) {
        ctx.db
          .prepare(
            'UPDATE graph_view SET is_default = 1 WHERE id = ? AND workspace_id = ?',
          )
          .run(id, ctx.workspaceId);
      }
    });
  }

  /** Vue de ce nom (sans casse) ; `null` si aucune, ou illisible. */
  findByName(name: string): GraphViewInfo | null {
    const ctx = this.context();
    const row = ctx.db
      .prepare(
        `${SELECT_VIEW} WHERE workspace_id = ? AND name = ? COLLATE NOCASE`,
      )
      .get(ctx.workspaceId, name) as GraphViewRow | undefined;
    return row ? toInfo(row) : null;
  }

  /** Vue d'identifiant donné ; `null` si elle n'existe plus, ou illisible. */
  find(id: string): GraphViewInfo | null {
    const ctx = this.context();
    const row = ctx.db
      .prepare(`${SELECT_VIEW} WHERE id = ? AND workspace_id = ?`)
      .get(id, ctx.workspaceId) as GraphViewRow | undefined;
    return row ? toInfo(row) : null;
  }

  private get(id: string): GraphViewInfo {
    const view = this.find(id);
    if (!view) throw notFound('La vue');
    return view;
  }

  private assertNameFree(name: string, exceptId: string | null): void {
    const ctx = this.context();
    const row = ctx.db
      .prepare(
        `SELECT id FROM graph_view
         WHERE workspace_id = ? AND name = ? COLLATE NOCASE AND id IS NOT ?`,
      )
      .get(ctx.workspaceId, name, exceptId);
    if (row) {
      throw new NodalError('CONFLICT', `Une vue s’appelle déjà « ${name} ».`);
    }
  }
}

function cameraJson(camera: CreateGraphViewInput['camera']): string | null {
  return camera ? JSON.stringify(graphCameraSchema.parse(camera)) : null;
}

function toInfo(row: GraphViewRow): GraphViewInfo | null {
  const settings = parseJson(row.settings, graphViewSettingsSchema);
  if (!settings) return null;
  return {
    id: row.id,
    name: row.name,
    settings: settings as GraphViewInfo['settings'],
    camera: parseJson(row.camera, graphCameraSchema) as GraphViewInfo['camera'],
    isDefault: row.is_default === 1,
    updatedAt: row.updated_at,
  };
}
