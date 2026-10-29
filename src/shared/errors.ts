/**
 * Codes d'erreur stables échangés via IPC. Le renderer s'appuie sur le code,
 * jamais sur le texte, pour décider d'un comportement.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'FORBIDDEN_SENDER',
  'FILE_NOT_FOUND',
  'FILE_ALREADY_EXISTS',
  'NOT_A_NODAL_FILE',
  'SCHEMA_TOO_NEW',
  'INVALID_WORKSPACE_FILE',
  'MIGRATION_FAILED',
  'NO_WORKSPACE_OPEN',
  'NOT_FOUND',
  'CONFLICT',
  'LIMIT_EXCEEDED',
  'IO_ERROR',
  'FILE_LOCKED',
  'DISK_FULL',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
}

/**
 * Traduit une erreur système connue (SQLite, système de fichiers) en erreur
 * lisible ; `null` si elle n'est pas reconnue (§10.2 : base verrouillée,
 * espace disque insuffisant).
 */
export function fromSystemError(error: unknown): NodalError | null {
  if (typeof error !== 'object' || error === null) return null;
  const { errcode, code } = error as { errcode?: number; code?: string };
  // Codes SQLite primaires : 5 BUSY, 6 LOCKED, 13 FULL.
  const primary = typeof errcode === 'number' ? errcode & 0xff : null;
  if (primary === 5 || primary === 6 || code === 'EBUSY') {
    return new NodalError(
      'FILE_LOCKED',
      'Le fichier de l’espace est verrouillé par un autre programme (ou une autre fenêtre). Fermez-le puis réessayez.',
      { cause: error },
    );
  }
  if (primary === 13 || code === 'ENOSPC') {
    return new NodalError(
      'DISK_FULL',
      'Espace disque insuffisant : libérez de la place puis réessayez. Les modifications non enregistrées sont conservées dans la fenêtre.',
      { cause: error },
    );
  }
  return null;
}

/** Erreur métier dont le message est destiné à l'utilisateur. */
export class NodalError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NodalError';
    this.code = code;
  }

  toJSON(): SerializedError {
    return { code: this.code, message: this.message };
  }
}
