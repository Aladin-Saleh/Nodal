/**
 * Ancrage aux fichiers du code, côté application : dossiers de code de
 * l'espace, motifs des nœuds, fichiers trouvés et documentation
 * possiblement obsolète. La vérification sur le disque (git, dates) est mise
 * en cache brièvement : l'arbre la redemande à chaque retour dans la fenêtre.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  toRootRelative,
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
  readCodeRoots,
  resolveCodeRoots,
  setAnchors,
  writeCodeRoots,
} from '../knowledge/anchor-service';
import type { ContextProvider } from '../knowledge/context';
import { describeAnchors, findStaleNodes } from './code-check';
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
      writeCodeRoots(ctx, [...stored, absolute]);
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
    const anchored = listAnchoredNodes(ctx, [nodeId]);
    const roots = this.roots();
    const [anchors, stale] = await Promise.all([
      describeAnchors(roots, patterns),
      findStaleNodes(roots, anchored, { run: this.options.run }),
    ]);
    return { anchors, stale: stale[0] ?? null, hasRoots: roots.length > 0 };
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
      const found = toRootRelative(file, roots, PATHS_CASE_INSENSITIVE);
      if (!found?.root || !found.path) {
        throw new NodalError(
          'VALIDATION_ERROR',
          `« ${file} » n'est dans aucun dossier de code de l'espace.`,
        );
      }
      return found.path;
    });
    const current = listAnchors(this.context(), nodeId);
    return this.setAnchors(nodeId, [...current, ...relative]);
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
    const result = findStaleNodes(roots, nodes, { run: this.options.run });
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
