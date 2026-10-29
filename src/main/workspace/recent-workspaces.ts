import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { RecentWorkspace } from '../../shared/model';

const MAX_ENTRIES = 10;

const entrySchema = z.object({
  filePath: z.string().min(1),
  name: z.string(),
  lastOpenedAt: z.string(),
});
const fileSchema = z.object({
  version: z.literal(1),
  entries: z.array(entrySchema),
});
type Entry = z.infer<typeof entrySchema>;

/** Identifiant stable d'un chemin : le renderer ne manipule jamais de chemin. */
export function recentId(filePath: string): string {
  const normalized = path.resolve(filePath);
  const key =
    process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Espaces récents (§6.1), stockés dans un petit fichier JSON du profil
 * utilisateur. Un fichier illisible ou corrompu est simplement ignoré.
 */
export class RecentWorkspacesStore {
  constructor(
    private readonly storePath: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): RecentWorkspace[] {
    return this.read().map((entry) => ({
      id: recentId(entry.filePath),
      name: entry.name,
      filePath: entry.filePath,
      lastOpenedAt: entry.lastOpenedAt,
      exists: fs.existsSync(entry.filePath),
    }));
  }

  /** Chemin associé à un identifiant, ou `null`. */
  resolve(id: string): string | null {
    return (
      this.read().find((entry) => recentId(entry.filePath) === id)?.filePath ??
      null
    );
  }

  touch(filePath: string, name: string): void {
    const id = recentId(filePath);
    const entries = this.read().filter(
      (entry) => recentId(entry.filePath) !== id,
    );
    entries.unshift({
      filePath: path.resolve(filePath),
      name,
      lastOpenedAt: this.now().toISOString(),
    });
    this.write(entries.slice(0, MAX_ENTRIES));
  }

  remove(id: string): void {
    this.write(this.read().filter((entry) => recentId(entry.filePath) !== id));
  }

  private read(): Entry[] {
    try {
      const parsed = fileSchema.safeParse(
        JSON.parse(fs.readFileSync(this.storePath, 'utf8')),
      );
      return parsed.success ? parsed.data.entries : [];
    } catch {
      return [];
    }
  }

  private write(entries: Entry[]): void {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      const temp = `${this.storePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ version: 1, entries }, null, 2));
      fs.renameSync(temp, this.storePath);
    } catch (error) {
      // La liste des récents est un confort : son échec ne bloque rien.
      console.warn('[recent] écriture impossible', error);
    }
  }
}
