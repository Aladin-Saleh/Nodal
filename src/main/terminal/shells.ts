/**
 * Shells proposés par le terminal intégré : ceux trouvés sur ce poste. Le
 * renderer n'envoie qu'un identifiant de cette liste, jamais un programme.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { TerminalShell } from '../../shared/terminal';

/** Shell détecté : programme et arguments fixes, jamais transmis au renderer. */
export interface DetectedShell extends TerminalShell {
  file: string;
  args: string[];
}

/** Fichier présent ; `lstat` accepte les alias du Microsoft Store (pwsh). */
const isFile = (file: string) => {
  try {
    return !fs.lstatSync(file).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Distributions WSL d'après `reg query … /v DistributionName` (la commande
 * wsl, elle, peut démarrer WSL ou proposer de l'installer). Celles de Docker
 * n'ont pas de shell utilisable.
 */
export function parseWslDistros(output: string): string[] {
  return [...output.matchAll(/DistributionName\s+REG_SZ\s+(\S+)\s*$/gmu)]
    .map((match) => match[1]!)
    .filter(
      (name) => /^\w[\w.-]*$/u.test(name) && !/^docker-desktop/iu.test(name),
    );
}

function windowsShells(
  env: NodeJS.ProcessEnv,
  distros: readonly string[],
  exists: (file: string) => boolean,
): DetectedShell[] {
  const join = path.win32.join;
  const pathDirs = (env.Path ?? env.PATH ?? '').split(';').filter(Boolean);
  const inPath = (file: string) =>
    pathDirs.map((dir) => join(dir, file)).find(exists);
  const system32 = join(env.SystemRoot ?? 'C:\\Windows', 'System32');
  /** Chemin complet s'il existe, sinon le nom (cherché par Windows). */
  const system = (...parts: string[]) => {
    const file = join(system32, ...parts);
    return exists(file) ? file : parts.at(-1)!;
  };

  const shells: DetectedShell[] = [];
  const pwsh = inPath('pwsh.exe');
  if (pwsh)
    shells.push({ id: 'pwsh', name: 'PowerShell 7', file: pwsh, args: [] });
  shells.push(
    {
      id: 'powershell',
      name: 'Windows PowerShell',
      file: system('WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [],
    },
    {
      id: 'cmd',
      name: 'Invite de commandes',
      file: system('cmd.exe'),
      args: [],
    },
  );

  const git = inPath('git.exe');
  const gitBash = [
    env.ProgramFiles && join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA &&
      join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    // git.exe est dans cmd\ ou dans mingw64\bin\ du dossier de Git.
    git && join(git, '..', '..', 'bin', 'bash.exe'),
    git && join(git, '..', '..', '..', 'bin', 'bash.exe'),
  ].find((file): file is string => Boolean(file) && exists(file as string));
  if (gitBash) {
    shells.push({
      id: 'git-bash',
      name: 'Git Bash',
      file: gitBash,
      args: ['--login', '-i'],
    });
  }

  const wsl = join(system32, 'wsl.exe');
  if (exists(wsl)) {
    for (const distro of distros) {
      shells.push({
        id: `wsl:${distro}`,
        name: `${distro} (WSL)`,
        file: wsl,
        args: ['-d', distro],
      });
    }
  }
  return shells;
}

/** Shells disponibles ; le premier est celui par défaut. */
export function detectShells(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  distros: readonly string[] = [],
  exists: (file: string) => boolean = isFile,
): DetectedShell[] {
  if (platform === 'win32') return windowsShells(env, distros, exists);
  const first = env.SHELL || '/bin/bash';
  const others = ['/bin/bash', '/bin/zsh', '/usr/bin/fish'].filter(exists);
  const byName = new Map<string, DetectedShell>();
  for (const file of [first, ...others]) {
    const name = path.posix.basename(file);
    if (!byName.has(name)) byName.set(name, { id: name, name, file, args: [] });
  }
  return [...byName.values()];
}

/** Chemin Windows en chemin Git Bash : `C:\a\b` → `/c/a/b`. */
const msysPath = (folder: string) =>
  folder
    .replace(
      /^([a-z]):[\\/]*/iu,
      (_match, drive: string) => `/${drive.toLowerCase()}/`,
    )
    .replace(/\\/gu, '/');

/** Texte entre apostrophes pour sh : `'` devient `'\''`. */
const shQuote = (text: string) => `'${text.replace(/'/gu, String.raw`'\''`)}'`;

/**
 * Saisie qui place le shell dans `folder` : la ligne en cours d'édition est
 * d'abord effacée (Échap pour PowerShell et cmd, Ctrl+U pour les autres),
 * puis la commande `cd` propre au shell est envoyée.
 */
export function changeDirectoryInput(shellId: string, folder: string): string {
  if (shellId === 'pwsh' || shellId === 'powershell') {
    return `\x1bSet-Location -LiteralPath '${folder.replace(/'/gu, "''")}'\r`;
  }
  // Un chemin Windows ne contient pas de guillemet.
  if (shellId === 'cmd') return `\x1bcd /d "${folder}"\r`;
  if (shellId === 'git-bash') return `\x15cd ${shQuote(msysPath(folder))}\r`;
  if (shellId.startsWith('wsl:')) {
    return `\x15cd "$(wslpath ${shQuote(folder)})"\r`;
  }
  return `\x15cd ${shQuote(folder)}\r`;
}
