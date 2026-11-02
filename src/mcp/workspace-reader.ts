/**
 * Accès à un fichier .nodal pour le serveur MCP.
 *
 * La connexion est ouverte pour chaque appel d'outil puis refermée : aucune
 * transaction ne reste ouverte (le checkpoint WAL de l'application n'est
 * jamais bloqué) et chaque appel voit les dernières modifications
 * enregistrées par Nodal, même si l'application est ouverte en parallèle.
 * Nodal détecte de son côté les écritures faites ici et recharge l'affichage.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { NodalError, fromSystemError } from '../shared/errors';
import {
  NODAL_APPLICATION_ID,
  getApplicationId,
} from '../main/database/connection';
import {
  LATEST_SCHEMA_VERSION,
  getSchemaVersion,
  runMigrations,
} from '../main/database/migrations';
import { inTransaction } from '../main/database/transaction';
import type { ServiceContext } from '../main/knowledge/context';
import {
  listWorkspaces,
  type WorkspaceRow,
} from '../main/workspace/workspace-repository';

const BUSY_TIMEOUT_MS = 5000;

export interface ReadContext extends ServiceContext {
  workspace: WorkspaceRow;
}

export type AccessMode = 'read' | 'write';

function readOnly(): never {
  throw new NodalError('VALIDATION_ERROR', 'Cet appel est en lecture seule.');
}

function openDatabase(filePath: string, mode: AccessMode): DatabaseSync {
  if (!fs.existsSync(filePath)) {
    throw new NodalError(
      'FILE_NOT_FOUND',
      `Le fichier « ${filePath} » est introuvable.`,
    );
  }
  // En lecture, connexion bridée par `query_only` plutôt qu'en mode
  // readOnly : une connexion readOnly crée les fichiers -wal et -shm sans
  // pouvoir les supprimer en se fermant. Le mode readOnly ne sert qu'en
  // repli, pour un fichier non modifiable.
  let db: DatabaseSync;
  let writable = true;
  try {
    db = new DatabaseSync(filePath, { enableForeignKeyConstraints: true });
  } catch (cause) {
    if (mode === 'write') {
      throw new NodalError(
        'INVALID_WORKSPACE_FILE',
        `Impossible d'ouvrir le fichier « ${filePath} » en écriture.`,
        { cause },
      );
    }
    try {
      db = new DatabaseSync(filePath, { readOnly: true });
      writable = false;
    } catch (readCause) {
      throw new NodalError(
        'INVALID_WORKSPACE_FILE',
        `Impossible d'ouvrir le fichier « ${filePath} ».`,
        { cause: readCause },
      );
    }
  }
  try {
    db.exec('PRAGMA trusted_schema = OFF');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    if (getApplicationId(db) !== NODAL_APPLICATION_ID) {
      throw new NodalError(
        'NOT_A_NODAL_FILE',
        "Ce fichier n'est pas un espace Nodal.",
      );
    }
    const version = getSchemaVersion(db);
    // Fichier d'une version plus récente de Nodal : lisible (les migrations
    // ne font qu'ajouter), jamais modifié. L'assistant garde ainsi l'accès à
    // la base même si le serveur installé n'a pas suivi l'application.
    if (version > LATEST_SCHEMA_VERSION) {
      if (mode === 'write') {
        throw new NodalError(
          'SCHEMA_TOO_NEW',
          `Ce fichier a été créé par une version plus récente de Nodal (schéma ${version}, ce serveur gère le schéma ${LATEST_SCHEMA_VERSION}) : lecture seule. Mettez à jour le serveur MCP de Nodal pour y écrire.`,
        );
      }
    }
    // Fichier d'une version précédente : mis à jour comme le ferait
    // l'application à l'ouverture (même en lecture, et même pour un serveur
    // --read-only : seule la structure change, pas le contenu). Sans cela, un
    // serveur à jour refuserait les espaces pas encore rouverts dans Nodal.
    if (version < LATEST_SCHEMA_VERSION) {
      if (!writable) {
        throw new NodalError(
          'INVALID_WORKSPACE_FILE',
          'Ce fichier utilise un ancien schéma et ne peut pas être modifié : ouvrez-le une fois dans Nodal pour le mettre à jour.',
        );
      }
      runMigrations(db);
    }
    if (mode === 'read') db.exec('PRAGMA query_only = ON');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * Exécute `fn` sur une connexion refermée ensuite. En écriture, `fn` s'exécute
 * dans une seule transaction : la modification et son entrée de journal sont
 * validées ensemble, ou pas du tout.
 */
export function withWorkspace<T>(
  filePath: string,
  fn: (ctx: ReadContext) => T,
  mode: AccessMode = 'read',
): T {
  const db = openDatabase(filePath, mode);
  try {
    const rows = listWorkspaces(db);
    if (rows.length !== 1) {
      throw new NodalError(
        'INVALID_WORKSPACE_FILE',
        `Fichier Nodal invalide : ${rows.length} espaces trouvés au lieu d'un seul.`,
      );
    }
    const workspace = rows[0]!;
    const ctx: ReadContext = {
      db,
      workspace,
      workspaceId: workspace.id,
      now: () => new Date().toISOString(),
      newId: mode === 'write' ? randomUUID : readOnly,
    };
    if (mode === 'read') return fn(ctx);
    try {
      return inTransaction(db, () => fn(ctx));
    } catch (error) {
      throw fromSystemError(error) ?? error;
    }
  } finally {
    db.close();
  }
}
