import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { NODAL_FILE_EXTENSION } from '../../shared/domain';
import { NodalError } from '../../shared/errors';
import type { WorkspaceInfo } from '../../shared/ipc-contract';
import { workspaceNameSchema } from '../../shared/ipc-schemas';
import {
  closeNodalDatabase,
  createNodalDatabase,
  openNodalDatabase,
} from '../database/connection';
import { getSchemaVersion } from '../database/migrations';
import { inTransaction } from '../database/transaction';
import {
  insertDefaultRelationTypes,
  insertWorkspace,
  listWorkspaces,
  type WorkspaceRow,
} from './workspace-repository';

export interface WorkspaceServiceOptions {
  now?: () => Date;
  generateId?: () => string;
}

interface OpenWorkspace {
  db: DatabaseSync;
  info: WorkspaceInfo;
}

/** Ajoute l'extension .nodal si le chemin n'en a pas déjà. */
export function ensureNodalExtension(filePath: string): string {
  const expected = `.${NODAL_FILE_EXTENSION}`;
  return path.extname(filePath).toLowerCase() === expected
    ? filePath
    : filePath + expected;
}

function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function toInfo(
  db: DatabaseSync,
  row: WorkspaceRow,
  filePath: string,
): WorkspaceInfo {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    filePath,
    schemaVersion: getSchemaVersion(db),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Gère l'espace de connaissances ouvert (un seul à la fois).
 * Indépendant d'Electron : testable directement sous Node.
 */
export class WorkspaceService {
  private current: OpenWorkspace | null = null;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(options: WorkspaceServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.generateId = options.generateId ?? randomUUID;
  }

  /**
   * Crée un fichier .nodal contenant l'espace et ses types de relations par
   * défaut, puis le définit comme espace courant. L'espace précédent n'est
   * fermé qu'en cas de succès.
   */
  create(filePath: string, name: string): WorkspaceInfo {
    const parsedName = workspaceNameSchema.safeParse(name);
    if (!parsedName.success) {
      throw new NodalError(
        'VALIDATION_ERROR',
        parsedName.error.issues[0]?.message ?? "Nom d'espace invalide.",
      );
    }
    const target = path.resolve(ensureNodalExtension(filePath));
    const db = createNodalDatabase(target);
    let info: WorkspaceInfo;
    try {
      const timestamp = this.now().toISOString();
      const row: WorkspaceRow = {
        id: this.generateId(),
        name: parsedName.data,
        description: null,
        created_at: timestamp,
        updated_at: timestamp,
      };
      inTransaction(db, () => {
        insertWorkspace(db, row);
        insertDefaultRelationTypes(db, row.id, this.generateId);
      });
      info = toInfo(db, row, target);
    } catch (error) {
      // Le fichier vient d'être créé par nous : ne pas laisser un projet vide.
      closeNodalDatabase(db);
      fs.rmSync(target, { force: true });
      throw error;
    }
    this.replaceCurrent({ db, info });
    return info;
  }

  /** Ouvre un fichier .nodal existant et le définit comme espace courant. */
  open(filePath: string): WorkspaceInfo {
    const target = path.resolve(filePath);
    if (this.current && samePath(this.current.info.filePath, target)) {
      return this.current.info;
    }
    const db = openNodalDatabase(target);
    let info: WorkspaceInfo;
    try {
      const rows = listWorkspaces(db);
      if (rows.length !== 1) {
        throw new NodalError(
          'INVALID_WORKSPACE_FILE',
          `Fichier Nodal invalide : ${rows.length} espaces trouvés au lieu d'un seul.`,
        );
      }
      info = toInfo(db, rows[0]!, target);
    } catch (error) {
      closeNodalDatabase(db);
      throw error;
    }
    this.replaceCurrent({ db, info });
    return info;
  }

  /** Ferme l'espace courant ; sans effet si aucun espace n'est ouvert. */
  close(): void {
    const current = this.current;
    this.current = null;
    if (current) closeNodalDatabase(current.db);
  }

  getCurrent(): WorkspaceInfo | null {
    return this.current?.info ?? null;
  }

  /** Accès à la base de l'espace courant, pour les services des lots suivants. */
  getDatabase(): DatabaseSync {
    if (!this.current) {
      throw new NodalError('NO_WORKSPACE_OPEN', "Aucun espace n'est ouvert.");
    }
    return this.current.db;
  }

  private replaceCurrent(next: OpenWorkspace): void {
    const previous = this.current;
    this.current = next;
    if (!previous) return;
    try {
      closeNodalDatabase(previous.db);
    } catch (error) {
      // La connexion est fermée malgré l'échec du checkpoint (cf. finally) ;
      // le journal WAL sera rejoué à la prochaine ouverture.
      console.error(
        "[workspace] échec de fermeture de l'espace précédent",
        error,
      );
    }
  }
}
