/**
 * Ancrage aux fichiers du code, côté application : dossiers de code de
 * l'espace, motifs des nœuds, fichiers trouvés et documentation
 * possiblement obsolète. La vérification sur le disque (git, dates) est mise
 * en cache brièvement : l'arbre la redemande à chaque retour dans la fenêtre.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CODE_FILE_VIEW_MAX_BYTES,
  matchesAnchor,
  patternIn,
  qualifiedPath,
  rootName,
  type CodeFileContent,
  type CodeRootInfo,
  type NodeAnchors,
  type StaleNode,
} from '../../shared/code-anchors';
import { NodalError } from '../../shared/errors';
import { inTransaction } from '../database/transaction';
import {
  PATHS_CASE_INSENSITIVE,
  listAnchoredNodes,
  listAnchors,
  markReviewed,
  qualifyAnchors,
  readCodeRoots,
  resolveCodeRoots,
  saveSnapshot,
  setAnchors,
  withSnapshots,
  writeCodeRoots,
} from '../knowledge/anchor-service';
import type { ContextProvider, ServiceContext } from '../knowledge/context';
import { checkCode, describeAnchors, type NodeSnapshot } from './code-check';
import type { GitRunner } from './git-history';

/** Durée de validité d'une vérification d'obsolescence (ms). */
export const STALE_CACHE_MS = 30_000;

const samePath = (a: string, b: string) =>
  PATHS_CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b;

export class CodeAnchorService {
  private cache: {
    key: string;
    at: number;
    result: Promise<StaleNode[]>;
  } | null = null;

  constructor(
    private readonly context: ContextProvider,
    /** Fichier .nodal de l'espace ouvert. */
    private readonly workspaceFile: () => string,
    private readonly options: { run?: GitRunner; clock?: () => number } = {},
  ) {}

  private roots(): string[] {
    return resolveCodeRoots(
      readCodeRoots(this.context()),
      this.workspaceFile(),
    );
  }

  getRoots(): CodeRootInfo[] {
    return this.roots().map((root) => ({
      path: root,
      exists: fs.existsSync(root) && fs.statSync(root).isDirectory(),
    }));
  }

  addRoot(directory: string): CodeRootInfo[] {
    const absolute = path.resolve(directory);
    const ctx = this.context();
    const stored = readCodeRoots(ctx);
    const resolved = resolveCodeRoots(stored, this.workspaceFile());
    if (!resolved.some((root) => samePath(root, absolute))) {
      // Les motifs désignent un dossier par son nom.
      const twin = resolved.find((root) =>
        samePath(rootName(root), rootName(absolute)),
      );
      if (twin) {
        throw new NodalError(
          'CONFLICT',
          `Un dossier de code porte déjà ce nom (${twin}) : renommez l’un des deux.`,
        );
      }
      inTransaction(ctx.db, () => {
        writeCodeRoots(ctx, [...stored, absolute]);
        // Jusqu'ici les motifs visaient le seul dossier : ils ne doivent pas
        // couvrir aussi les fichiers de même chemin du nouveau.
        if (resolved.length === 1) qualifyAnchors(ctx, rootName(resolved[0]!));
      });
      this.invalidate();
    }
    return this.getRoots();
  }

  removeRoot(directory: string): CodeRootInfo[] {
    const ctx = this.context();
    const base = this.workspaceFile();
    const stored = readCodeRoots(ctx);
    const kept = stored.filter(
      (root) => !samePath(resolveCodeRoots([root], base)[0]!, directory),
    );
    if (kept.length !== stored.length) {
      writeCodeRoots(ctx, kept);
      this.invalidate();
    }
    return this.getRoots();
  }

  async listForNode(nodeId: string): Promise<NodeAnchors> {
    const ctx = this.context();
    const patterns = listAnchors(ctx, nodeId);
    const anchored = withSnapshots(ctx, listAnchoredNodes(ctx, [nodeId]));
    const roots = this.roots();
    const [anchors, { stale, snapshots }] = await Promise.all([
      describeAnchors(roots, patterns),
      checkCode(roots, anchored, { run: this.options.run }),
    ]);
    this.save(ctx, snapshots);
    return { anchors, stale: stale[0] ?? null, hasRoots: roots.length > 0 };
  }

  /**
   * Garde les états relevés, pour comparer ensuite des contenus. Un échec
   * (espace refermé entre-temps, fichier en lecture seule) n'a pour effet que
   * de les relever à nouveau.
   */
  private save(ctx: ServiceContext, snapshots: readonly NodeSnapshot[]): void {
    if (snapshots.length === 0) return;
    try {
      if (this.context().db !== ctx.db) return;
      inTransaction(ctx.db, () => {
        for (const { nodeId, snapshot } of snapshots)
          saveSnapshot(ctx, nodeId, snapshot);
      });
    } catch {
      // Relevé à la prochaine vérification.
    }
  }

  setAnchors(nodeId: string, patterns: string[]): string[] {
    const ctx = this.context();
    const saved = inTransaction(ctx.db, () =>
      setAnchors(ctx, nodeId, patterns),
    );
    this.invalidate();
    return saved;
  }

  /**
   * Ajoute des fichiers choisis sur le disque : chacun doit se trouver dans
   * un dossier de code, il est ancré par son chemin relatif.
   */
  addFiles(nodeId: string, files: string[]): string[] {
    const roots = this.roots();
    const relative = files.map((file) => {
      const found = qualifiedPath(file, roots, PATHS_CASE_INSENSITIVE);
      if (!found) {
        throw new NodalError(
          'VALIDATION_ERROR',
          `« ${file} » n'est dans aucun dossier de code de l'espace.`,
        );
      }
      return found;
    });
    const current = listAnchors(this.context(), nodeId);
    return this.setAnchors(nodeId, [...current, ...relative]);
  }

  /**
   * Contenu d'un fichier ancré au nœud, pour le consulter sans quitter
   * l'application. `file` est le chemin affiché (préfixé du nom du dossier
   * s'il y en a plusieurs) ; il doit correspondre à un motif du nœud et rester
   * dans son dossier de code, liens symboliques compris.
   */
  async readFile(nodeId: string, file: string): Promise<CodeFileContent> {
    const roots = this.getRoots()
      .filter((root) => root.exists)
      .map((root) => root.path);
    const slash = roots.length > 1 ? file.indexOf('/') : -1;
    const root =
      roots.length > 1
        ? roots.find((candidate) =>
            samePath(rootName(candidate), file.slice(0, slash)),
          )
        : roots[0];
    const relative = file.slice(slash + 1);
    const segments = relative.split('/');
    const anchored =
      root !== undefined &&
      !relative.includes('\\') &&
      segments.every(
        (segment) => segment && segment !== '.' && segment !== '..',
      ) &&
      listAnchors(this.context(), nodeId).some((pattern) => {
        const local = patternIn(pattern, root, PATHS_CASE_INSENSITIVE);
        return (
          local !== null &&
          matchesAnchor(local, relative, PATHS_CASE_INSENSITIVE)
        );
      });
    if (!anchored) {
      throw new NodalError(
        'NOT_FOUND',
        `« ${file} » n'est pas un fichier ancré à ce nœud.`,
      );
    }

    let real: string;
    let realRoot: string;
    let stats: fs.Stats;
    try {
      [real, realRoot] = await Promise.all([
        fs.promises.realpath(path.join(root, ...segments)),
        fs.promises.realpath(root),
      ]);
      stats = await fs.promises.stat(real);
    } catch {
      throw new NodalError('FILE_NOT_FOUND', `« ${file} » est introuvable.`);
    }
    if (!stats.isFile() || !real.startsWith(realRoot + path.sep)) {
      throw new NodalError(
        'NOT_FOUND',
        `« ${file} » n'est pas un fichier du dossier de code.`,
      );
    }
    const size = stats.size;
    if (size > CODE_FILE_VIEW_MAX_BYTES) {
      return {
        path: file,
        size,
        content: null,
        note: 'Fichier trop volumineux pour être affiché.',
      };
    }
    const bytes = await fs.promises.readFile(real);
    // Un octet nul dans le début du fichier : contenu binaire.
    if (bytes.subarray(0, 8000).includes(0)) {
      return {
        path: file,
        size,
        content: null,
        note: 'Fichier binaire : aperçu impossible.',
      };
    }
    return { path: file, size, content: bytes.toString('utf8'), note: null };
  }

  markReviewed(nodeId: string): void {
    markReviewed(this.context(), nodeId);
    this.invalidate();
  }

  /** Nœuds possiblement obsolètes (résultat gardé STALE_CACHE_MS). */
  staleNodes(): Promise<StaleNode[]> {
    const ctx = this.context();
    const roots = this.roots();
    const nodes = listAnchoredNodes(ctx);
    if (roots.length === 0 || nodes.length === 0) return Promise.resolve([]);
    // Une date de référence ou un motif changé : nouvelle vérification.
    const key = JSON.stringify([roots, nodes]);
    const now = (this.options.clock ?? Date.now)();
    if (this.cache?.key === key && now - this.cache.at < STALE_CACHE_MS) {
      return this.cache.result;
    }
    const result = checkCode(roots, withSnapshots(ctx, nodes), {
      run: this.options.run,
    }).then(({ stale, snapshots }) => {
      this.save(ctx, snapshots);
      return stale;
    });
    this.cache = { key, at: now, result };
    result.catch(() => {
      if (this.cache?.result === result) this.cache = null;
    });
    return result;
  }

  invalidate(): void {
    this.cache = null;
  }

  /** Dossier de départ du sélecteur de fichiers : le premier dossier de code. */
  firstRoot(): string | null {
    return this.getRoots().find((root) => root.exists)?.path ?? null;
  }
}
