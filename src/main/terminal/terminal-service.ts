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
import {
  changeDirectoryInput,
  detectShells,
  parseWslDistros,
  type DetectedShell,
} from './shells';

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
  /** Dossiers où l'on peut ouvrir un terminal ou s'y déplacer (dossiers de code). */
  folders(): string[];
  /** Fichier de l'espace ouvert, transmis au shell. */
  workspaceFile(): string | null;
  /** Shells disponibles (tests) ; par défaut, ceux du poste. */
  shells?(): DetectedShell[];
}

/** Même dossier (casse ignorée sous Windows). */
const sameFolder = (a: string, b: string) =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);

export class TerminalService {
  private readonly sessions = new Map<string, IPty>();
  /** Shell de chaque terminal ouvert, pour la commande `cd`. */
  private readonly shellIds = new Map<string, string>();
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
    /** Dossier de code où démarrer ; inconnu → dossier par défaut. */
    folder?: string;
  }): Promise<TerminalSession> {
    const shells = await this.shells();
    const shell = shells.find(({ id }) => id === input.shell) ?? shells[0]!;
    if (this.sessions.size >= TERMINAL_MAX_SESSIONS) {
      throw new NodalError(
        'LIMIT_EXCEEDED',
        `${TERMINAL_MAX_SESSIONS} terminaux au plus : fermez-en un.`,
      );
    }
    let cwd =
      (input.folder !== undefined && this.folder(input.folder)) ||
      this.options.cwd();
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
    this.shellIds.set(id, shell.id);
    pty.onData((data) => this.options.emit({ kind: 'data', id, data }));
    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id);
      this.shellIds.delete(id);
      this.options.emit({ kind: 'exit', id, exitCode });
    });
    return { id, shell: shell.name, shellId: shell.id, cwd };
  }

  write(id: string, data: string): void {
    this.session(id).write(data);
  }

  /**
   * Place le shell dans un dossier de code de l'espace, en lui tapant la
   * commande `cd`. Le dossier doit être l'un de `folders()` ; renvoie le
   * dossier tel qu'il y figure.
   */
  changeDirectory(id: string, folder: string): string {
    const pty = this.session(id);
    const known = this.folder(folder);
    if (!known) {
      throw new NodalError(
        'NOT_FOUND',
        "Ce dossier n'est pas un dossier de code de l'espace.",
      );
    }
    pty.write(changeDirectoryInput(this.shellIds.get(id) ?? '', known));
    return known;
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
    this.shellIds.delete(id);
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
      this.shellIds.delete(id);
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

  /** Dossier de code existant correspondant à `folder`, sinon `null`. */
  private folder(folder: string): string | null {
    return (
      this.options
        .folders()
        .find((known) => sameFolder(known, folder) && fs.existsSync(known)) ??
      null
    );
  }

  private session(id: string): IPty {
    const pty = this.sessions.get(id);
    if (!pty) throw new NodalError('NOT_FOUND', 'Ce terminal est fermé.');
    return pty;
  }
}
