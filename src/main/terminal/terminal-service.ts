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
import {
  TERMINAL_MAX_SESSIONS,
  type TerminalEvent,
  type TerminalSession,
  type TerminalShell,
} from '../../shared/terminal';
import { detectShells, parseWslDistros, type DetectedShell } from './shells';

type NodePty = typeof import('node-pty');

/** Charge node-pty : copie embarquée (application installée) ou node_modules. */
export function loadNodePty(resourcesPath: string | null): NodePty {
  const nodeRequire = createRequire(__filename);
  return nodeRequire(
    resourcesPath ? path.join(resourcesPath, 'node-pty') : 'node-pty',
  ) as NodePty;
}

/** Distributions WSL installées, lues dans le registre. */
function wslDistros(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss';
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', key, '/s', '/v', 'DistributionName'],
      { timeout: 3000, windowsHide: true },
      // Clé absente (WSL non installé) : aucune distribution.
      (_error, stdout) => resolve(parseWslDistros(stdout)),
    );
  });
}

export interface TerminalServiceOptions {
  pty: () => NodePty;
  /** Envoie un événement à la fenêtre principale. */
  emit(event: TerminalEvent): void;
  /** Dossier de départ (dossier de code, sinon dossier de l'espace). */
  cwd(): string;
  /** Fichier de l'espace ouvert, transmis au shell. */
  workspaceFile(): string | null;
  /** Shells disponibles (tests) ; par défaut, ceux du poste. */
  shells?(): DetectedShell[];
}

export class TerminalService {
  private readonly sessions = new Map<string, IPty>();
  private nextId = 1;

  constructor(private readonly options: TerminalServiceOptions) {}

  /** Shells proposés, le premier par défaut (sans programme ni arguments). */
  async listShells(): Promise<TerminalShell[]> {
    return (await this.shells()).map(({ id, name }) => ({ id, name }));
  }

  /** Ouvre le shell demandé, ou celui par défaut s'il n'existe pas (ou plus). */
  async create(input: {
    cols: number;
    rows: number;
    shell?: string;
  }): Promise<TerminalSession> {
    const shells = await this.shells();
    const shell = shells.find(({ id }) => id === input.shell) ?? shells[0]!;
    if (this.sessions.size >= TERMINAL_MAX_SESSIONS) {
      throw new NodalError(
        'LIMIT_EXCEEDED',
        `${TERMINAL_MAX_SESSIONS} terminaux au plus : fermez-en un.`,
      );
    }
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
    if (workspaceFile) {
      env.NODAL_WORKSPACE = workspaceFile;
      // Transmise à WSL, chemin traduit (/mnt/c/…).
      env.WSLENV = [env.WSLENV, 'NODAL_WORKSPACE/p'].filter(Boolean).join(':');
    }
    const forkOptions: IPtyForkOptions = {
      name: 'xterm-256color',
      cols: input.cols,
      rows: input.rows,
      cwd,
      env,
    };
    const pty = this.options.pty().spawn(shell.file, shell.args, forkOptions);
    const id = String(this.nextId++);
    this.sessions.set(id, pty);
    pty.onData((data) => this.options.emit({ kind: 'data', id, data }));
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.options.emit({ kind: 'exit', id, exitCode });
    });
    return { id, shell: shell.name, shellId: shell.id, cwd };
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

  private async shells(): Promise<DetectedShell[]> {
    return (
      this.options.shells?.() ??
      detectShells(process.platform, process.env, await wslDistros())
    );
  }

  private session(id: string): IPty {
    const pty = this.sessions.get(id);
    if (!pty) throw new NodalError('NOT_FOUND', 'Ce terminal est fermé.');
    return pty;
  }
}
