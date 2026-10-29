import { ATTACHMENT_MAX_SIZE_DEFAULT_BYTES } from '../../shared/domain';
import type { WorkspaceSettings } from '../../shared/model';
import { workspaceSettingsSchema } from '../../shared/ipc-schemas';
import type { ContextProvider, ServiceContext } from './context';
import { inTransaction } from '../database/transaction';

const KEYS = {
  attachmentMaxSizeBytes: 'attachment.maxSizeBytes',
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
}
