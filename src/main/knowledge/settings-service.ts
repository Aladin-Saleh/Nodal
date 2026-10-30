import { ATTACHMENT_MAX_SIZE_DEFAULT_BYTES } from '../../shared/domain';
import type { GraphViewSettings, WorkspaceSettings } from '../../shared/model';
import {
  graphViewSettingsSchema,
  workspaceSettingsSchema,
} from '../../shared/ipc-schemas';
import type { ContextProvider, ServiceContext } from './context';
import { inTransaction } from '../database/transaction';

const KEYS = {
  attachmentMaxSizeBytes: 'attachment.maxSizeBytes',
  /**
   * Réglages d'affichage du graphe (JSON). Hors de WorkspaceSettings : ce
   * n'est pas un paramètre de l'espace et il n'est pas exporté.
   */
  graphView: 'view.graph',
} as const;

const DEFAULTS: WorkspaceSettings = {
  attachmentMaxSizeBytes: ATTACHMENT_MAX_SIZE_DEFAULT_BYTES,
};

export function readSettings(ctx: ServiceContext): WorkspaceSettings {
  const stored = new Map(
    (
      ctx.db
        .prepare(
          'SELECT key, value FROM workspace_settings WHERE workspace_id = ?',
        )
        .all(ctx.workspaceId) as { key: string; value: string }[]
    ).map((entry) => [entry.key, entry.value]),
  );
  const candidate = {
    attachmentMaxSizeBytes: Number(
      stored.get(KEYS.attachmentMaxSizeBytes) ??
        DEFAULTS.attachmentMaxSizeBytes,
    ),
  };
  // Une valeur stockée invalide (fichier modifié à la main) retombe sur le défaut.
  const parsed = workspaceSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULTS;
}

/** Paramètres propres à l'espace, stockés dans workspace_settings. */
export class SettingsService {
  constructor(private readonly context: ContextProvider) {}

  get(): WorkspaceSettings {
    return readSettings(this.context());
  }

  update(settings: WorkspaceSettings): WorkspaceSettings {
    const ctx = this.context();
    const upsert = ctx.db.prepare(
      `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value`,
    );
    inTransaction(ctx.db, () => {
      upsert.run(
        ctx.workspaceId,
        KEYS.attachmentMaxSizeBytes,
        String(settings.attachmentMaxSizeBytes),
      );
    });
    return readSettings(ctx);
  }

  /** Réglages d'affichage du graphe ; `null` s'ils sont absents ou illisibles. */
  getGraphView(): GraphViewSettings | null {
    const ctx = this.context();
    const row = ctx.db
      .prepare(
        'SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?',
      )
      .get(ctx.workspaceId, KEYS.graphView) as { value: string } | undefined;
    if (!row) return null;
    try {
      const parsed = graphViewSettingsSchema.safeParse(JSON.parse(row.value));
      return parsed.success ? parsed.data : null;
    } catch {
      // JSON modifié à la main : on repart des réglages par défaut.
      return null;
    }
  }

  saveGraphView(view: GraphViewSettings): void {
    const ctx = this.context();
    const value = JSON.stringify(graphViewSettingsSchema.parse(view));
    ctx.db
      .prepare(
        `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value`,
      )
      .run(ctx.workspaceId, KEYS.graphView, value);
  }
}
