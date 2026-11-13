/** Terminal intégré : types partagés par le main et le renderer. */

/** Terminal ouvert : identifiant, nom du shell et dossier de départ. */
export interface TerminalSession {
  id: string;
  shell: string;
  cwd: string;
}

/** Événement d'un terminal, envoyé par le main. */
export type TerminalEvent =
  | { kind: 'data'; id: string; data: string }
  | { kind: 'exit'; id: string; exitCode: number };

/** Taille d'un terminal, en caractères. */
export const TERMINAL_MAX_COLS = 1_000;
export const TERMINAL_MAX_ROWS = 500;
/** Saisie transmise en un appel au plus (collage d'un long texte). */
export const TERMINAL_MAX_INPUT = 1_000_000;
