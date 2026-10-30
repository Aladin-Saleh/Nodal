/**
 * Préférences de l'application et état de la fenêtre, stockés dans de petits
 * fichiers JSON du profil utilisateur. Un fichier illisible ou une valeur
 * invalide sont ignorés : on retombe sur les valeurs par défaut, champ par
 * champ, sans jamais bloquer le démarrage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
  type AppPreferences,
  type PreferencesUpdate,
} from '../shared/preferences';

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Écriture atomique : un arrêt brutal ne laisse pas de fichier tronqué. */
function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

export class PreferencesStore {
  private cache: AppPreferences | null = null;

  constructor(private readonly storePath: string) {}

  get(): AppPreferences {
    if (this.cache) return this.cache;
    const stored = readJson(this.storePath);
    const preferences = { ...DEFAULT_PREFERENCES };
    if (stored && typeof stored === 'object') {
      // Champ par champ : une valeur invalide n'efface pas les autres.
      for (const key of Object.keys(
        DEFAULT_PREFERENCES,
      ) as (keyof AppPreferences)[]) {
        const parsed = preferencesSchema.shape[key].safeParse(
          (stored as Record<string, unknown>)[key],
        );
        if (parsed.success) Object.assign(preferences, { [key]: parsed.data });
      }
    }
    this.cache = preferences;
    return preferences;
  }

  update(changes: PreferencesUpdate): AppPreferences {
    const next = preferencesSchema.parse({ ...this.get(), ...changes });
    writeJson(this.storePath, next);
    this.cache = next;
    return next;
  }
}

const boundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(400),
  height: z.number().int().min(300),
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof boundsSchema>;

/** Taille, position et état agrandi de la fenêtre principale. */
export class WindowStateStore {
  constructor(private readonly storePath: string) {}

  get(): WindowState | null {
    const parsed = boundsSchema.safeParse(readJson(this.storePath));
    return parsed.success ? parsed.data : null;
  }

  save(state: WindowState): void {
    try {
      writeJson(this.storePath, state);
    } catch (error) {
      console.error('[window] état de la fenêtre non enregistré', error);
    }
  }
}
