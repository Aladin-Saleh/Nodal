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
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
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
