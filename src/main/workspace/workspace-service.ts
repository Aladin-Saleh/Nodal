import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { NODAL_FILE_EXTENSION } from '../../shared/domain';
import { NodalError } from '../../shared/errors';
import type {
  UpdateWorkspaceInput,
  WorkspaceInfo,
} from '../../shared/ipc-contract';
import { workspaceNameSchema } from '../../shared/ipc-schemas';
import {
  closeNodalDatabase,
  createNodalDatabase,
  openNodalDatabase,
} from '../database/connection';
import { getSchemaVersion } from '../database/migrations';
import { inTransaction } from '../database/transaction';
import type { ServiceContext } from '../knowledge/context';
import {
  importFailure,
  writeImport,
  type ExportManifest,
} from '../knowledge/import-service';
import {
  insertDefaultRelationTypes,
  insertWorkspace,
  listWorkspaces,
  updateWorkspace,
  type WorkspaceRow,
} from './workspace-repository';

export interface WorkspaceServiceOptions {
  now?: () => Date;
  generateId?: () => string;
}

interface OpenWorkspace {
  db: DatabaseSync;
  info: WorkspaceInfo;
  /** Dernière valeur vue de PRAGMA data_version (écritures externes). */
  dataVersion: number;
}

/** Compteur qui change quand une autre connexion valide une écriture. */
function readDataVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA data_version').get() as { data_version: number })
    .data_version;
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

  /**
   * Crée un nouvel espace à partir d'un export validé et l'ouvre. Le fichier
   * est supprimé si l'écriture échoue.
   */
  importFrom(
    filePath: string,
    manifest: ExportManifest,
    root: string,
  ): {
    info: WorkspaceInfo;
    nodeCount: number;
    documentCount: number;
    attachmentCount: number;
  } {
    const target = path.resolve(ensureNodalExtension(filePath));
    const db = createNodalDatabase(target);
    let counts: {
      nodeCount: number;
      documentCount: number;
      attachmentCount: number;
    };
    let info: WorkspaceInfo;
    try {
      counts = writeImport(db, manifest, root);
      const [row] = listWorkspaces(db);
      info = toInfo(db, row!, target);
    } catch (error) {
      closeNodalDatabase(db);
      fs.rmSync(target, { force: true });
      throw importFailure(error);
    }
    this.replaceCurrent({ db, info });
    return { info, ...counts };
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

  /** Accès à la base de l'espace courant. */
  getDatabase(): DatabaseSync {
    return this.requireCurrent().db;
  }

  /**
   * `true` si une autre connexion (le serveur MCP) a validé une écriture dans
   * le fichier depuis l'appel précédent — ou depuis l'ouverture de l'espace :
   * la référence est relevée dès l'ouverture, pour ne manquer aucune écriture.
   * Nos propres écritures ne comptent pas.
   */
  takeExternalChange(): boolean {
    const current = this.current;
    if (!current) return false;
    const version = readDataVersion(current.db);
    if (version === current.dataVersion) return false;
    current.dataVersion = version;
    return true;
  }

  /** Contexte transmis aux services métier (nœuds, documents, tags…). */
  getContext(): ServiceContext {
    const { db, info } = this.requireCurrent();
    return {
      db,
      workspaceId: info.id,
      now: () => this.now().toISOString(),
      newId: this.generateId,
    };
  }

  /** Renomme l'espace courant et/ou modifie sa description. */
  update(input: UpdateWorkspaceInput): WorkspaceInfo {
    const current = this.requireCurrent();
    const next: WorkspaceInfo = {
      ...current.info,
      name: input.name ?? current.info.name,
      description:
        input.description === undefined
          ? current.info.description
          : input.description,
      updatedAt: this.now().toISOString(),
    };
    updateWorkspace(current.db, {
      id: next.id,
      name: next.name,
      description: next.description,
      updated_at: next.updatedAt,
    });
    current.info = next;
    return next;
  }

  private requireCurrent(): OpenWorkspace {
    if (!this.current) {
      throw new NodalError('NO_WORKSPACE_OPEN', "Aucun espace n'est ouvert.");
    }
    return this.current;
  }

  private replaceCurrent(next: Omit<OpenWorkspace, 'dataVersion'>): void {
    const previous = this.current;
    this.current = { ...next, dataVersion: readDataVersion(next.db) };
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
