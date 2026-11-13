/**
 * Terminal intégré : des pseudo-terminaux (node-pty) dont l'entrée et la
 * sortie passent par l'IPC. Le shell démarre dans le dossier de code de
 * l'espace, avec `NODAL_WORKSPACE` = fichier de l'espace (le serveur MCP de
 * Nodal le lit quand aucun fichier ne lui est donné).
 *
 * Sous Windows, node-pty termine un terminal en lançant un processus Node
 * (`child_process.fork`) : interdit ici (fusible RunAsNode), il relancerait
 * Nodal. On termine donc l'arbre de processus avec `taskkill`.
 */
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { IPty, IPtyForkOptions } from 'node-pty';
import { NodalError } from '../../shared/errors';
import type { TerminalEvent, TerminalSession } from '../../shared/terminal';

type NodePty = typeof import('node-pty');

/** Charge node-pty : copie embarquée (application installée) ou node_modules. */
export function loadNodePty(resourcesPath: string | null): NodePty {
  const nodeRequire = createRequire(__filename);
  return nodeRequire(
    resourcesPath ? path.join(resourcesPath, 'node-pty') : 'node-pty',
  ) as NodePty;
}

const isFile = (file: string) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** Shell par défaut : PowerShell 7 s'il est installé, sinon Windows PowerShell. */
export function defaultShell(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== 'win32') return env.SHELL || '/bin/bash';
  const pathDirs = (env.Path ?? env.PATH ?? '').split(path.delimiter);
  const pwsh = pathDirs
    .map((dir) => path.join(dir, 'pwsh.exe'))
    .find((file) => isFile(file));
  return pwsh ?? 'powershell.exe';
}

export interface TerminalServiceOptions {
  pty: () => NodePty;
  /** Envoie un événement à la fenêtre principale. */
  emit(event: TerminalEvent): void;
  /** Dossier de départ (dossier de code, sinon dossier de l'espace). */
  cwd(): string;
  /** Fichier de l'espace ouvert, transmis au shell. */
  workspaceFile(): string | null;
  shell?: string;
}

/** Nombre maximal de terminaux ouverts en même temps. */
const MAX_SESSIONS = 8;

export class TerminalService {
  private readonly sessions = new Map<string, IPty>();
  private nextId = 1;

  constructor(private readonly options: TerminalServiceOptions) {}

  create(size: { cols: number; rows: number }): TerminalSession {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new NodalError(
        'LIMIT_EXCEEDED',
        `${MAX_SESSIONS} terminaux au plus : fermez-en un.`,
      );
    }
    const shell = this.options.shell ?? defaultShell();
    let cwd = this.options.cwd();
    if (!fs.existsSync(cwd)) cwd = os.homedir();
    const workspaceFile = this.options.workspaceFile();
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    // Variables d'Electron inutiles (voire gênantes) pour les programmes lancés.
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODAL_E2E_USER_DATA;
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    if (workspaceFile) env.NODAL_WORKSPACE = workspaceFile;
    const forkOptions: IPtyForkOptions = {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env,
    };
    const pty = this.options.pty().spawn(shell, [], forkOptions);
    const id = String(this.nextId++);
    this.sessions.set(id, pty);
    pty.onData((data) => this.options.emit({ kind: 'data', id, data }));
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.options.emit({ kind: 'exit', id, exitCode });
    });
    return { id, shell: path.basename(shell), cwd };
  }

  write(id: string, data: string): void {
    this.session(id).write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const pty = this.sessions.get(id);
    // Redimensionner un terminal qui vient de se terminer lève une erreur.
    if (!pty) return;
    try {
      pty.resize(cols, rows);
    } catch {
      // Terminal en cours de fermeture.
    }
  }

  close(id: string): void {
    const pty = this.sessions.get(id);
    if (!pty) return;
    this.sessions.delete(id);
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pty.pid), '/T', '/F'], () => {
        // Déjà terminé : rien à faire.
      });
    } else {
      pty.kill();
    }
  }

  /** Ferme tous les terminaux (fermeture de l'espace ou de l'application). */
  closeAll(): void {
    for (const [id, pty] of this.sessions) {
      this.sessions.delete(id);
      if (process.platform === 'win32') {
        try {
          execFileSync('taskkill', ['/PID', String(pty.pid), '/T', '/F'], {
            stdio: 'ignore',
          });
        } catch {
          // Déjà terminé.
        }
      } else {
        pty.kill();
      }
    }
  }

  private session(id: string): IPty {
    const pty = this.sessions.get(id);
    if (!pty) throw new NodalError('NOT_FOUND', 'Ce terminal est fermé.');
    return pty;
  }
}
