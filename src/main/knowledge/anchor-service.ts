/**
 * Ancrage des nœuds aux fichiers du code (partie base de données, partagée
 * par l'application et le serveur MCP) : dossiers de code de l'espace,
 * motifs ancrés à chaque nœud, date de référence pour la détection de
 * documentation obsolète et « Marquer comme à jour ».
 *
 * La lecture des fichiers et de l'historique git est à part (main/code) :
 * elle est asynchrone et ne doit jamais tenir une connexion ouverte.
 */
import path from 'node:path';
import {
  ANCHORS_MAX_PER_NODE,
  CODE_ROOTS_MAX,
  matchesAnchor,
  normalizeAnchorPattern,
} from '../../shared/code-anchors';
import { NodalError } from '../../shared/errors';
import { notFound, type ServiceContext } from './context';
import { asRow, asRows } from './rows';

/** Clé de workspace_settings : liste JSON des dossiers de code. */
const CODE_ROOTS_KEY = 'code.roots';

/** Windows et macOS : chemins insensibles à la casse. */
export const PATHS_CASE_INSENSITIVE =
  process.platform === 'win32' || process.platform === 'darwin';

/**
 * Dossiers de code tels qu'enregistrés (chemins locaux). Un chemin relatif
 * (fichier modifié à la main) est résolu par rapport au fichier .nodal.
 */
export function readCodeRoots(ctx: ServiceContext): string[] {
  const row = asRow<{ value: string }>(
    ctx.db
      .prepare(
        'SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?',
      )
      .get(ctx.workspaceId, CODE_ROOTS_KEY),
  );
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    // JSON modifié à la main : aucun dossier plutôt qu'une erreur.
    return [];
  }
}

export function writeCodeRoots(ctx: ServiceContext, roots: string[]): void {
  if (roots.length > CODE_ROOTS_MAX) {
    throw new NodalError(
      'LIMIT_EXCEEDED',
      `${CODE_ROOTS_MAX} dossiers de code au plus par espace.`,
    );
  }
  ctx.db
    .prepare(
      `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value`,
    )
    .run(ctx.workspaceId, CODE_ROOTS_KEY, JSON.stringify(roots));
}

/** Chemins absolus des dossiers de code (relatifs : au dossier du .nodal). */
export function resolveCodeRoots(
  stored: readonly string[],
  workspaceFile: string,
): string[] {
  const base = path.dirname(workspaceFile);
  return [...new Set(stored.map((root) => path.resolve(base, root)))];
}

function assertNode(ctx: ServiceContext, nodeId: string): void {
  const exists = ctx.db
    .prepare('SELECT 1 FROM node WHERE id = ? AND workspace_id = ?')
    .get(nodeId, ctx.workspaceId);
  if (!exists) throw notFound('Nœud');
}

/**
 * Motif lu dans la base encore valide : un fichier .nodal modifié à la main
 * (ou reçu d'un tiers) ne doit pas faire lire hors des dossiers de code.
 */
const isSafePattern = (pattern: string) => {
  const checked = normalizeAnchorPattern(pattern);
  return checked.ok && checked.pattern === pattern;
};

/** Motifs ancrés à un nœud, dans l'ordre d'ajout. */
export function listAnchors(ctx: ServiceContext, nodeId: string): string[] {
  return asRows<{ pattern: string }>(
    ctx.db
      .prepare(
        'SELECT pattern FROM node_anchor WHERE node_id = ? ORDER BY sort_order, pattern',
      )
      .all(nodeId),
  )
    .map((row) => row.pattern)
    .filter(isSafePattern);
}

/** Valide et normalise une liste de motifs (doublons retirés). */
export function normalizeAnchorList(patterns: readonly string[]): string[] {
  const result: string[] = [];
  for (const raw of patterns) {
    const checked = normalizeAnchorPattern(raw);
    if (!checked.ok) {
      throw new NodalError(
        'VALIDATION_ERROR',
        `« ${raw} » : ${checked.reason}`,
      );
    }
    if (!result.includes(checked.pattern)) result.push(checked.pattern);
  }
  if (result.length > ANCHORS_MAX_PER_NODE) {
    throw new NodalError(
      'LIMIT_EXCEEDED',
      `${ANCHORS_MAX_PER_NODE} fichiers ou motifs ancrés au plus par nœud.`,
    );
  }
  return result;
}

/** Remplace les motifs ancrés au nœud ; renvoie la liste enregistrée. */
export function setAnchors(
  ctx: ServiceContext,
  nodeId: string,
  patterns: readonly string[],
): string[] {
  assertNode(ctx, nodeId);
  const next = normalizeAnchorList(patterns);
  const current = listAnchors(ctx, nodeId);
  if (
    current.length === next.length &&
    current.every((pattern, index) => pattern === next[index])
  ) {
    return current;
  }
  ctx.db.prepare('DELETE FROM node_anchor WHERE node_id = ?').run(nodeId);
  const insert = ctx.db.prepare(
    'INSERT INTO node_anchor (node_id, pattern, sort_order, created_at) VALUES (?, ?, ?, ?)',
  );
  const now = ctx.now();
  next.forEach((pattern, index) => insert.run(nodeId, pattern, index, now));
  return next;
}

/** Nœud ancré, avec la date à partir de laquelle un changement compte. */
export interface AnchoredNode {
  nodeId: string;
  title: string;
  patterns: string[];
  /** Plus récente des dates : nœud, documents, « Marquer comme à jour ». */
  since: string;
}

/** Nœuds ancrés de l'espace (tous, ou ceux de `nodeIds`). */
export function listAnchoredNodes(
  ctx: ServiceContext,
  nodeIds?: readonly string[],
): AnchoredNode[] {
  if (nodeIds && nodeIds.length === 0) return [];
  const rows = asRows<{
    id: string;
    title: string;
    since: string;
    patterns: string;
  }>(
    ctx.db
      .prepare(
        // Dates ISO 8601 de même format : la comparaison de textes suffit.
        `SELECT n.id, n.title,
           max(n.updated_at, coalesce(n.code_reviewed_at, ''),
               coalesce((SELECT max(d.updated_at) FROM document d WHERE d.node_id = n.id), '')) AS since,
           (SELECT json_group_array(pattern) FROM
              (SELECT pattern FROM node_anchor a WHERE a.node_id = n.id ORDER BY sort_order, pattern)) AS patterns
         FROM node n
         WHERE n.workspace_id = ?
           AND EXISTS (SELECT 1 FROM node_anchor a WHERE a.node_id = n.id)
         ORDER BY n.rowid`,
      )
      .all(ctx.workspaceId),
  );
  const wanted = nodeIds ? new Set(nodeIds) : null;
  return rows
    .filter((row) => !wanted || wanted.has(row.id))
    .map((row) => ({
      nodeId: row.id,
      title: row.title,
      patterns: (JSON.parse(row.patterns) as string[]).filter(isSafePattern),
      since: row.since,
    }));
}

/** « Marquer comme à jour » : la documentation reflète le code actuel. */
export function markReviewed(ctx: ServiceContext, nodeId: string): void {
  assertNode(ctx, nodeId);
  ctx.db
    .prepare('UPDATE node SET code_reviewed_at = ? WHERE id = ?')
    .run(ctx.now(), nodeId);
}

/** Nœuds dont un motif couvre l'un des chemins relatifs donnés. */
export function nodesForPaths(
  ctx: ServiceContext,
  relativePaths: readonly string[],
): { node: AnchoredNode; paths: string[] }[] {
  const found: { node: AnchoredNode; paths: string[] }[] = [];
  for (const node of listAnchoredNodes(ctx)) {
    const paths = relativePaths.filter((file) =>
      node.patterns.some((pattern) =>
        matchesAnchor(pattern, file, PATHS_CASE_INSENSITIVE),
      ),
    );
    if (paths.length > 0) found.push({ node, paths });
  }
  return found;
}
