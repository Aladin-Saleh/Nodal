import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppUrlConfig {
  /** URL du serveur Vite en développement, sinon `undefined`. */
  devServerUrl: string | undefined;
  /** Chemin absolu de l'index.html packagé. */
  rendererIndexPath: string;
}

export type AppUrlMatcher = (url: string) => boolean;

/**
 * Construit le prédicat « cette URL est-elle l'interface de l'application ? ».
 * En développement : même origine que le serveur Vite.
 * En production : exactement le fichier index.html du renderer.
 */
export function createAppUrlMatcher(config: AppUrlConfig): AppUrlMatcher {
  const devOrigin = config.devServerUrl
    ? new URL(config.devServerUrl).origin
    : null;
  const indexPath = normalizePath(config.rendererIndexPath);

  return (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (devOrigin) return parsed.origin === devOrigin;
    if (parsed.protocol !== 'file:' || parsed.host !== '') return false;
    try {
      return normalizePath(fileURLToPath(parsed)) === indexPath;
    } catch {
      return false;
    }
  };
}

function normalizePath(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** Seuls les liens web sont confiés au navigateur du système. */
export function isExternalWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
