import type { DatabaseSync } from 'node:sqlite';
import { NodalError } from '../../shared/errors';

/** Ce dont un service métier a besoin pour agir sur l'espace ouvert. */
export interface ServiceContext {
  db: DatabaseSync;
  workspaceId: string;
  /** Horodatage ISO 8601 (UTC). */
  now(): string;
  newId(): string;
}

/** Fournit le contexte de l'espace courant ; lève NO_WORKSPACE_OPEN sinon. */
export type ContextProvider = () => ServiceContext;

export function notFound(what: string): NodalError {
  return new NodalError('NOT_FOUND', `${what} introuvable.`);
}
