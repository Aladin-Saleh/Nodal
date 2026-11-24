/**
 * Fichiers ancrés et documentation possiblement obsolète, sur le disque
 * (lecture seule). Utilisé par l'application et le serveur MCP, hors de
 * toute connexion à la base : les nœuds ancrés sont lus avant.
 *
 * Chaque nœud garde l'empreinte des fichiers que sa documentation reflète
 * (CodeSnapshot) : un fichier est modifié si son empreinte n'est plus celle-là.
 * La documentation ayant pu être mise à jour depuis, l'état est alors relevé
 * à nouveau, fichier par fichier, du plus sûr au moins sûr :
 * - fichier pas réécrit depuis la mise à jour : son contenu actuel ;
 * - contenu identique à l'état précédent : le même ;
 * - dossier sous git : son contenu dans le dernier commit antérieur ;
 * - sinon inconnu : seule la date de modification en décide.
 */
import path from 'node:path';
import {
  matchesAnchor,
  type AnchorFiles,
  type ChangedFile,
  type CodeSnapshot,
  type StaleNode,
} from '../../shared/code-anchors';
import type { AnchoredNode } from '../knowledge/anchor-service';
import { PATHS_CASE_INSENSITIVE } from '../knowledge/anchor-service';
import {
  isDirectory,
  modifiedAt,
  scanPattern,
  type PatternFiles,
} from './file-scan';
import {
  contentFingerprint,
  fileFingerprint,
  matchesGitBlob,
} from './fingerprint';
import {
  filesCommittedSince,
  gitFilesAt,
  isGitWorkTree,
  listGitFiles,
  readGitBlob,
  runGit,
  type GitRunner,
} from './git-history';

/** Fichiers modifiés listés au plus par nœud (le compte reste exact). */
export const STALE_FILES_LIMIT = 20;
/** Fichiers listés au plus par motif dans le panneau du nœud. */
export const ANCHOR_FILES_LIMIT = 50;
/**
 * Contenus lus au plus dans git par nœud (un processus par fichier) ;
 * au-delà, un fichier différent du commit est jugé sur sa date.
 */
export const GIT_BLOBS_LIMIT = 40;
/** Vérifications de nœuds menées en parallèle. */
const CONCURRENCY = 4;

export interface CodeCheckOptions {
  run?: GitRunner;
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** Dossiers de code qui existent (les autres sont ignorés). */
async function existingRoots(roots: readonly string[]): Promise<string[]> {
  const checks = await Promise.all(roots.map((root) => isDirectory(root)));
  return roots.filter((_, index) => checks[index]);
}

const matchesAny = (patterns: readonly string[], file: string) =>
  patterns.some((pattern) =>
    matchesAnchor(pattern, file, PATHS_CASE_INSENSITIVE),
  );

/** Empreintes des contenus lus dans git : un objet ne change jamais. */
const blobFingerprints = new Map<string, string>();
const BLOB_CACHE_MAX = 5_000;

/** Dossier de code, avec ce qui est lu une fois par vérification. */
class CheckedRoot {
  /** Nom du dossier : préfixe des clés d'un état (CodeSnapshot). */
  readonly name: string;
  private readonly trees = new Map<string, Promise<Map<string, string>>>();

  private constructor(
    readonly root: string,
    private readonly gitFiles: readonly string[] | null,
    private readonly run: GitRunner,
  ) {
    this.name = path.basename(root);
  }

  static async open(root: string, run: GitRunner): Promise<CheckedRoot> {
    let files: string[] | null = null;
    if (await isGitWorkTree(root, run)) {
      // git en échec (délai dépassé…) : parcours du dossier, dates seules.
      files = await listGitFiles(root, run).catch(() => null);
    }
    return new CheckedRoot(root, files, run);
  }

  get git(): boolean {
    return this.gitFiles !== null;
  }

  key(file: string): string {
    return `${this.name}/${file}`;
  }

  absolute(file: string): string {
    return path.join(this.root, ...file.split('/'));
  }

  /** Fichiers couverts par les motifs, avec leur date de modification. */
  async files(patterns: readonly string[]): Promise<Map<string, Date>> {
    let names: string[];
    if (this.gitFiles) {
      names = this.gitFiles.filter((file) => matchesAny(patterns, file));
    } else {
      const found = await Promise.all(
        patterns.map((pattern) =>
          scanPattern(this.root, pattern, {
            caseInsensitive: PATHS_CASE_INSENSITIVE,
            limit: Number.POSITIVE_INFINITY,
          }),
        ),
      );
      names = [...new Set(found.flatMap((result) => result.files))];
    }
    const files = new Map<string, Date>();
    for (const name of names) {
      const mtime = await modifiedAt(this.root, name);
      // Suivi par git mais supprimé, ou lien symbolique.
      if (mtime) files.set(name, mtime);
    }
    return files;
  }

  /** Fichiers du dernier commit antérieur à `since`. */
  filesAt(since: Date): Promise<Map<string, string>> {
    const key = since.toISOString();
    let tree = this.trees.get(key);
    if (!tree) {
      tree = gitFilesAt(this.root, since, this.run);
      this.trees.set(key, tree);
    }
    return tree;
  }

  /** Empreinte d'un objet git ; `null` s'il n'a pas pu être lu. */
  async blobFingerprint(objectId: string, file: string) {
    const key = `${objectId}:${path.basename(file)}`;
    let value = blobFingerprints.get(key);
    if (value === undefined) {
      try {
        value = contentFingerprint(
          await readGitBlob(this.root, objectId, this.run),
          path.basename(file),
        );
      } catch {
        return null;
      }
      if (blobFingerprints.size >= BLOB_CACHE_MAX) blobFingerprints.clear();
      blobFingerprints.set(key, value);
    }
    return value;
  }

  /** Date du commit qui a supprimé un fichier, ou maintenant. */
  async deletedAt(file: string, since: Date): Promise<string> {
    const now = new Date().toISOString();
    if (!this.git) return now;
    try {
      const commits = await filesCommittedSince(
        this.root,
        [file],
        since,
        this.run,
      );
      return commits.get(file) ?? now;
    } catch {
      return now;
    }
  }
}

/** État du code d'un nœud : fichiers actuels et empreintes de référence. */
interface NodeCheck {
  node: AnchoredNode;
  snapshot: CodeSnapshot;
  /** L'état a été relevé à nouveau (à enregistrer). */
  rebuilt: boolean;
  /** Fichiers actuels, par clé d'état. */
  current: Map<string, { root: CheckedRoot; file: string; mtime: Date }>;
  stale: StaleNode | null;
}

/** Empreinte de référence d'un fichier ; `undefined` : il n'existait pas. */
async function baselineOf(
  root: CheckedRoot,
  file: string,
  mtime: Date,
  since: Date,
  previous: string | null | undefined,
  blobs: { left: number },
): Promise<string | null | undefined> {
  const absolute = root.absolute(file);
  const current = await fileFingerprint(absolute);
  if (mtime <= since || (previous && previous === current)) return current;
  if (!root.git) return null;
  const objectId = (await root.filesAt(since)).get(file);
  if (!objectId) return undefined;
  if (await matchesGitBlob(absolute, objectId)) return current;
  if (blobs.left <= 0) return null;
  blobs.left--;
  return root.blobFingerprint(objectId, file);
}

/** État de référence du nœud : celui enregistré s'il est encore valable. */
async function snapshotOf(
  node: AnchoredNode,
  roots: readonly CheckedRoot[],
  current: NodeCheck['current'],
): Promise<{ snapshot: CodeSnapshot; rebuilt: boolean }> {
  const { snapshot: known } = node;
  const valid = known?.since === node.since;
  const samePatterns =
    known?.patterns.length === node.patterns.length &&
    known.patterns.every((pattern) => node.patterns.includes(pattern));
  if (known && valid && samePatterns)
    return { snapshot: known, rebuilt: false };

  const since = new Date(node.since);
  const files: CodeSnapshot['files'] = {};
  const blobs = { left: GIT_BLOBS_LIMIT };
  for (const [key, { root, file, mtime }] of current) {
    // Motif ajouté depuis : seuls les fichiers qu'il apporte sont relevés.
    const baseline =
      valid && matchesAny(known.patterns, file)
        ? known.files[key]
        : await baselineOf(root, file, mtime, since, known?.files[key], blobs);
    if (baseline !== undefined) files[key] = baseline;
  }
  // Fichiers disparus : présents dans l'état encore valable, ou dans git.
  const missing = new Set(
    valid
      ? Object.keys(known.files).filter((key) =>
          matchesAny(node.patterns, key.slice(key.indexOf('/') + 1)),
        )
      : [],
  );
  for (const root of roots) {
    if (!root.git) continue;
    for (const file of (await root.filesAt(since)).keys()) {
      if (!matchesAny(node.patterns, file)) continue;
      if (valid && matchesAny(known.patterns, file)) continue;
      missing.add(root.key(file));
    }
  }
  for (const key of missing) {
    if (!current.has(key)) files[key] = known?.files[key] ?? null;
  }
  return {
    snapshot: { since: node.since, patterns: [...node.patterns], files },
    rebuilt: true,
  };
}

async function checkNode(
  node: AnchoredNode,
  roots: readonly CheckedRoot[],
): Promise<NodeCheck | null> {
  const since = new Date(node.since);
  if (Number.isNaN(since.getTime())) return null;
  const current: NodeCheck['current'] = new Map();
  for (const root of roots) {
    for (const [file, mtime] of await root.files(node.patterns)) {
      current.set(root.key(file), { root, file, mtime });
    }
  }
  const { snapshot, rebuilt } = await snapshotOf(node, roots, current);

  // Plusieurs dossiers : le nom du dossier distingue les chemins.
  const shown = (key: string) =>
    roots.length > 1 ? key : key.slice(key.indexOf('/') + 1);
  const changed: ChangedFile[] = [];
  let byDate = false;
  for (const [key, { root, file, mtime }] of current) {
    const baseline = snapshot.files[key];
    const changedAt = mtime.toISOString();
    if (baseline === undefined) {
      changed.push({ path: shown(key), changedAt, added: true });
    } else if (baseline === null) {
      if (mtime <= since) continue;
      byDate = true;
      changed.push({ path: shown(key), changedAt });
    } else if ((await fileFingerprint(root.absolute(file))) !== baseline) {
      changed.push({ path: shown(key), changedAt });
    }
  }
  for (const key of Object.keys(snapshot.files)) {
    if (current.has(key)) continue;
    const file = key.slice(key.indexOf('/') + 1);
    const root = roots.find((item) => item.key(file) === key);
    // Dossier de code absent de cette machine : rien à dire de ses fichiers.
    if (!root) continue;
    changed.push({
      path: shown(key),
      changedAt: await root.deletedAt(file, since),
      deleted: true,
    });
  }
  const files = changed.toSorted((a, b) =>
    b.changedAt.localeCompare(a.changedAt),
  );
  return {
    node,
    snapshot,
    rebuilt,
    current,
    stale:
      files.length === 0
        ? null
        : {
            nodeId: node.nodeId,
            since: node.since,
            files: files.slice(0, STALE_FILES_LIMIT),
            fileCount: files.length,
            source: byDate ? 'mtime' : 'content',
          },
  };
}

async function checkNodes(
  roots: readonly string[],
  nodes: readonly AnchoredNode[],
  run: GitRunner,
): Promise<NodeCheck[]> {
  if (nodes.length === 0) return [];
  const usable = await existingRoots(roots);
  if (usable.length === 0) return [];
  const checked = await Promise.all(
    usable.map((root) => CheckedRoot.open(root, run)),
  );
  const results = await mapLimited(nodes, CONCURRENCY, (node) =>
    // git ou disque en échec : ce nœud est ignoré cette fois.
    checkNode(node, checked).catch(() => null),
  );
  return results.filter((item) => item !== null);
}

/** État à enregistrer pour un nœud (saveSnapshot). */
export interface NodeSnapshot {
  nodeId: string;
  snapshot: CodeSnapshot;
}

/**
 * Nœuds dont un fichier ancré a changé depuis leur date de référence, et
 * états relevés à nouveau, à enregistrer. `roots` : dossiers de code absolus.
 */
export async function checkCode(
  roots: readonly string[],
  nodes: readonly AnchoredNode[],
  options: CodeCheckOptions = {},
): Promise<{ stale: StaleNode[]; snapshots: NodeSnapshot[] }> {
  const checks = await checkNodes(roots, nodes, options.run ?? runGit);
  return {
    stale: checks.flatMap((check) => check.stale ?? []),
    snapshots: checks
      .filter((check) => check.rebuilt)
      .map(({ node, snapshot }) => ({ nodeId: node.nodeId, snapshot })),
  };
}

export async function findStaleNodes(
  roots: readonly string[],
  nodes: readonly AnchoredNode[],
  options: CodeCheckOptions = {},
): Promise<StaleNode[]> {
  return (await checkCode(roots, nodes, options)).stale;
}

/** Fichier ancré au moment d'une écriture. */
export interface WrittenFile {
  relative: string;
  absolute: string;
  fingerprint: string | null;
  mtime: Date;
}

/** Nœud ancré avant (`null` : créé ou ancré à l'instant) et après l'écriture. */
export interface NodeWrite {
  before: AnchoredNode | null;
  after: AnchoredNode;
  /** L'assistant a-t-il vu ce fichier dans son état actuel ? */
  isRead(file: WrittenFile): boolean;
  /** Fichiers déclarés relus (chemins relatifs), supprimés compris. */
  reviewed: readonly string[];
}

const samePath = (a: string, b: string) =>
  PATHS_CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b;

/**
 * État du code après une écriture d'un assistant. Un fichier qui avait déjà
 * changé, et que l'assistant n'a pas vu, reste à relire : mettre un nœud à
 * jour ne prouve pas que tout son code a été relu.
 */
export async function snapshotsAfterWrite(
  roots: readonly string[],
  writes: readonly NodeWrite[],
  options: CodeCheckOptions = {},
): Promise<NodeSnapshot[]> {
  // Motifs d'après l'écriture, contenu de référence d'avant.
  const checks = await checkNodes(
    roots,
    writes.map(({ before, after }) => ({
      ...after,
      ...(before && { since: before.since, snapshot: before.snapshot }),
    })),
    options.run ?? runGit,
  );
  return Promise.all(
    checks.map(async ({ node, snapshot, current }) => {
      const write = writes.find(({ after }) => after.nodeId === node.nodeId)!;
      const { before, after } = write;
      const reviewed = (file: string) =>
        write.reviewed.some((item) => samePath(item, file));
      const files: CodeSnapshot['files'] = {};
      for (const [key, { root, file, mtime }] of current) {
        const absolute = root.absolute(file);
        const fingerprint = await fileFingerprint(absolute);
        const baseline = snapshot.files[key];
        const upToDate =
          before === null ||
          baseline === fingerprint ||
          (baseline === null && mtime <= new Date(before.since)) ||
          reviewed(file) ||
          write.isRead({ relative: file, absolute, fingerprint, mtime });
        if (upToDate) files[key] = fingerprint;
        else if (baseline !== undefined) files[key] = baseline ?? '';
      }
      for (const [key, baseline] of Object.entries(snapshot.files)) {
        if (current.has(key) || before === null) continue;
        if (!reviewed(key.slice(key.indexOf('/') + 1))) files[key] = baseline;
      }
      return {
        nodeId: node.nodeId,
        snapshot: { since: after.since, patterns: [...after.patterns], files },
      };
    }),
  );
}

/** Fichiers couverts par chaque motif d'un nœud, tous dossiers confondus. */
export async function describeAnchors(
  roots: readonly string[],
  patterns: readonly string[],
): Promise<AnchorFiles[]> {
  const usable = await existingRoots(roots);
  const multiple = usable.length > 1;
  return Promise.all(
    patterns.map(async (pattern) => {
      const perRoot: PatternFiles[] = await Promise.all(
        usable.map((root) =>
          scanPattern(root, pattern, {
            caseInsensitive: PATHS_CASE_INSENSITIVE,
            limit: ANCHOR_FILES_LIMIT,
          }),
        ),
      );
      const files = perRoot
        .flatMap((result, index) =>
          result.files.map((file) =>
            multiple ? `${path.basename(usable[index]!)}/${file}` : file,
          ),
        )
        .slice(0, ANCHOR_FILES_LIMIT);
      return {
        pattern,
        files,
        count: perRoot.reduce((sum, result) => sum + result.count, 0),
        truncated: perRoot.some((result) => result.truncated),
      };
    }),
  );
}
