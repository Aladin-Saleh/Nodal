/** Terminal intégré : types partagés par le main et le renderer. */

/** Type de terminal proposé (PowerShell, invite de commandes, WSL…). */
export interface TerminalShell {
  id: string;
  name: string;
}

/** Terminal ouvert : identifiant, nom du shell et dossier de départ. */
export interface TerminalSession {
  id: string;
  shell: string;
  shellId: string;
  cwd: string;
}

/** Événement d'un terminal, envoyé par le main. */
export type TerminalEvent =
  | { kind: 'data'; id: string; data: string }
  | { kind: 'exit'; id: string; exitCode: number };

/** Nombre maximal de terminaux ouverts en même temps. */
export const TERMINAL_MAX_SESSIONS = 8;
/** Taille d'un terminal, en caractères. */
export const TERMINAL_MAX_COLS = 1_000;
export const TERMINAL_MAX_ROWS = 500;
/** Saisie transmise en un appel au plus (collage d'un long texte). */
export const TERMINAL_MAX_INPUT = 1_000_000;
