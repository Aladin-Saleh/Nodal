/**
 * Import d'un dossier Markdown ou d'un coffre Obsidian dans l'espace ouvert :
 * les dossiers deviennent la hiérarchie, chaque note un nœud avec son
 * document, le front-matter donne titre, type, résumé et tags, les liens
 * deviennent des liens [[node:…]] (et leurs relations), les fichiers
 * référencés des pièces jointes.
 *
 * Sécurité : les fichiers sont lus comme des données (texte UTF-8 ou octets
 * d'une pièce jointe), jamais exécutés ni interprétés ; les liens symboliques
 * et les dossiers cachés (.obsidian, .git…) sont ignorés ; un lien ne peut
 * pas viser un fichier hors du dossier.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DOCUMENT_BODY_MAX_LENGTH,
  SUMMARY_MAX_LENGTH,
  TAG_NAME_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  type NodeType,
} from '../../shared/domain';
import { NodalError } from '../../shared/errors';
import {
  MARKDOWN_IMPORT_LIST_LIMIT,
  MARKDOWN_IMPORT_MAX_DEPTH,
  MARKDOWN_IMPORT_MAX_NOTES,
  type MarkdownImportPreview,
  type MarkdownImportReport,
  type SkippedEntry,
  type UnresolvedLink,
} from '../../shared/markdown-import';
import { formatNodeLink } from '../../shared/wiki-links';
import { inTransaction } from '../database/transaction';
import { AttachmentService } from '../knowledge/attachment-service';
import type { ServiceContext } from '../knowledge/context';
import { DocumentService } from '../knowledge/document-service';
import { workspaceLinkResolver } from '../knowledge/link-service';
import { NodeService } from '../knowledge/node-service';
import { readSettings } from '../knowledge/settings-service';
import { TagService } from '../knowledge/tag-service';
import {
  createVaultResolver,
  findVaultLinks,
  readFrontMatter,
  rewriteVaultLinks,
  type FrontMatter,
  type VaultLink,
  type VaultNote,
} from './vault';

interface ScannedNote extends VaultNote {
  meta: FrontMatter | null;
  /** Texte après le front-matter. */
  body: string;
}

/** Contenu lu d'un dossier, gardé par le main entre l'aperçu et l'import. */
export interface ScannedFolder {
  /** Dossier choisi (absolu). */
  root: string;
  folderName: string;
  /** Sous-dossiers, chemins relatifs `/`, parents avant enfants. */
  folders: string[];
  notes: ScannedNote[];
  /** Autres fichiers (pièces jointes possibles), chemins relatifs. */
  files: string[];
  skipped: SkippedEntry[];
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Parcourt le dossier et lit les notes ; aucune écriture. */
export function scanMarkdownFolder(root: string): ScannedFolder {
  const folders: string[] = [];
  const notes: ScannedNote[] = [];
  const files: string[] = [];
  const skipped: SkippedEntry[] = [];

  const walk = (relative: string, depth: number) => {
    if (depth > MARKDOWN_IMPORT_MAX_DEPTH) {
      skipped.push({ path: relative, reason: 'dossier trop profond' });
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, relative), {
        withFileTypes: true,
      });
    } catch {
      skipped.push({ path: relative || '.', reason: 'dossier illisible' });
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    for (const entry of entries) {
      // .obsidian, .git, .trash… : réglages et historique, pas du contenu.
      if (entry.name.startsWith('.')) continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        skipped.push({ path: child, reason: 'lien symbolique ignoré' });
      } else if (entry.isDirectory()) {
        folders.push(child);
        walk(child, depth + 1);
      } else if (!entry.isFile()) {
        skipped.push({ path: child, reason: 'type de fichier ignoré' });
      } else if (/\.md$/i.test(entry.name)) {
        if (notes.length >= MARKDOWN_IMPORT_MAX_NOTES) {
          throw new NodalError(
            'LIMIT_EXCEEDED',
            `Plus de ${MARKDOWN_IMPORT_MAX_NOTES} notes : importez plutôt un sous-dossier.`,
          );
        }
        const note = readNote(root, child, skipped);
        if (note) notes.push(note);
      } else {
        files.push(child);
      }
    }
  };
  walk('', 0);

  return {
    root,
    folderName: path.basename(path.resolve(root)) || 'Import',
    folders,
    notes,
    files,
    skipped,
  };
}

function readNote(
  root: string,
  relative: string,
  skipped: SkippedEntry[],
): ScannedNote | null {
  let text: string;
  try {
    const data = fs.readFileSync(path.join(root, relative));
    text = utf8.decode(data);
  } catch (error) {
    skipped.push({
      path: relative,
      reason:
        error instanceof TypeError ? 'encodage non UTF-8' : 'fichier illisible',
    });
    return null;
  }
  if (text.length > DOCUMENT_BODY_MAX_LENGTH) {
    skipped.push({ path: relative, reason: 'note trop volumineuse' });
    return null;
  }
  const { meta, body } = readFrontMatter(text);
  const name = path.posix.basename(relative).replace(/\.md$/i, '');
  return {
    path: relative,
    title: clip(meta?.title ?? name, TITLE_MAX_LENGTH) || 'Sans titre',
    aliases: meta?.aliases ?? [],
    meta,
    body,
  };
}

/** Une ligne de texte, tronquée, sans caractères de contrôle. */
function clip(value: string, max: number): string {
  // oxlint-disable-next-line no-control-regex
  const line = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// --- Analyse : liens et pièces jointes ---------------------------------------

type Resolution =
  | { kind: 'note'; note: ScannedNote; text: string | null }
  | { kind: 'existing'; id: string; text: string | null }
  | { kind: 'file'; file: string }
  | { kind: 'unresolved'; text: string }
  | { kind: 'keep' };

interface Analysis {
  resolutions: Map<ScannedNote, { link: VaultLink; resolution: Resolution }[]>;
  /** Pièce jointe → première note qui la cite. */
  attachments: Map<string, ScannedNote>;
  linkCount: number;
  unresolved: UnresolvedLink[];
  skipped: SkippedEntry[];
}

const hasOtherExtension = (target: string) =>
  /\.[a-z0-9]{1,8}$/i.test(target) && !/\.md$/i.test(target);

function analyze(scan: ScannedFolder, ctx: ServiceContext): Analysis {
  const resolver = createVaultResolver(scan.notes, scan.files);
  const existing = workspaceLinkResolver(ctx);
  const { attachmentMaxSizeBytes } = readSettings(ctx);
  const resolutions: Analysis['resolutions'] = new Map();
  const attachments = new Map<string, ScannedNote>();
  const unresolved: UnresolvedLink[] = [];
  const skipped = [...scan.skipped];
  const tooLarge = new Set<string>();
  let linkCount = 0;

  const resolve = (note: ScannedNote, link: VaultLink): Resolution => {
    // [[#Titre]] : renvoi dans la même note.
    if (!link.target) return { kind: 'keep' };
    const isNote = link.style === 'wiki' || /\.md$/i.test(link.target);
    const target = isNote ? resolver.note(link.target, note.path) : null;
    const text =
      link.alias ??
      (link.heading
        ? `${target?.title ?? link.target} › ${link.heading}`
        : null);
    if (target) return { kind: 'note', note: target, text };
    const file = resolver.file(link.target, note.path);
    if (file && (!isNote || hasOtherExtension(link.target))) {
      if (fileSize(scan.root, file) > attachmentMaxSizeBytes) {
        if (!tooLarge.has(file)) {
          tooLarge.add(file);
          skipped.push({ path: file, reason: 'pièce jointe trop volumineuse' });
        }
        return { kind: 'keep' };
      }
      return { kind: 'file', file };
    }
    if (!isNote) return { kind: 'keep' };
    const known = hasOtherExtension(link.target)
      ? undefined
      : existing.idOfTitle(link.target.replace(/\.md$/i, ''));
    if (known) return { kind: 'existing', id: known, text };
    return {
      kind: 'unresolved',
      text: `[[${link.target.replace(/\.md$/i, '')}${link.alias ? `|${link.alias}` : ''}]]`,
    };
  };

  for (const note of scan.notes) {
    const entries: { link: VaultLink; resolution: Resolution }[] = [];
    for (const link of findVaultLinks(note.body)) {
      const resolution = resolve(note, link);
      entries.push({ link, resolution });
      if (resolution.kind === 'note' || resolution.kind === 'existing') {
        linkCount++;
      } else if (resolution.kind === 'unresolved') {
        unresolved.push({ note: note.path, target: link.target });
      } else if (
        resolution.kind === 'file' &&
        !attachments.has(resolution.file)
      ) {
        attachments.set(resolution.file, note);
      }
    }
    resolutions.set(note, entries);
  }
  return { resolutions, attachments, linkCount, unresolved, skipped };
}

function fileSize(root: string, relative: string): number {
  try {
    const stat = fs.lstatSync(path.join(root, relative));
    return stat.isFile() ? stat.size : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Dossiers qui contiennent au moins une note (les autres ne créent rien). */
function foldersWithNotes(scan: ScannedFolder): string[] {
  const used = new Set<string>();
  for (const note of scan.notes) {
    let directory = path.posix.dirname(note.path);
    while (directory !== '.' && !used.has(directory)) {
      used.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  return scan.folders.filter((folder) => used.has(folder));
}

/**
 * Sauvegarde automatique avant un import, à côté du fichier de l'espace :
 * « <nom>-avant-import-<date>.nodal », jamais un fichier existant.
 */
export function backupPathBeforeImport(
  workspaceFile: string,
  now: Date,
): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*$/, '')
    .replace('T', '-');
  const base = path.join(
    path.dirname(workspaceFile),
    `${path.basename(workspaceFile, path.extname(workspaceFile))}-avant-import-${stamp}`,
  );
  let candidate = `${base}.nodal`;
  for (let n = 2; fs.existsSync(candidate); n++)
    candidate = `${base}-${n}.nodal`;
  return candidate;
}

const capped = <T>(items: T[]) => items.slice(0, MARKDOWN_IMPORT_LIST_LIMIT);

/** Aperçu : ce que l'import créera, sans rien écrire. */
export function previewMarkdownImport(
  scan: ScannedFolder,
  ctx: ServiceContext,
  token: string,
): MarkdownImportPreview {
  const analysis = analyze(scan, ctx);
  return {
    token,
    folderName: scan.folderName,
    folderCount: foldersWithNotes(scan).length,
    noteCount: scan.notes.length,
    attachmentCount: analysis.attachments.size,
    linkCount: analysis.linkCount,
    unresolvedCount: analysis.unresolved.length,
    unresolved: capped(analysis.unresolved),
    skippedCount: analysis.skipped.length,
    skipped: capped(analysis.skipped),
    frontMatterCount: scan.notes.filter(
      (note) =>
        note.meta &&
        (note.meta.nodeType || note.meta.summary || note.meta.tags.length > 0),
    ).length,
  };
}

/**
 * Écrit l'import sous un nouveau nœud racine, en une transaction : en cas
 * d'erreur, l'espace reste tel qu'il était. La sauvegarde est faite avant
 * par l'appelant.
 */
export function writeMarkdownImport(
  scan: ScannedFolder,
  ctx: ServiceContext,
  backupPath: string,
): MarkdownImportReport {
  const analysis = analyze(scan, ctx);
  const provider = () => ctx;
  const nodes = new NodeService(provider);
  const documents = new DocumentService(provider);
  const attachmentService = new AttachmentService(provider);
  const tags = new TagService(provider);

  const create = (parentId: string | null, title: string, type: NodeType) =>
    nodes.create({ parentId, title, nodeType: type }).id;

  return inTransaction(ctx.db, () => {
    const tagIds = new Map(
      tags.list().map((tag) => [tag.name.toLocaleLowerCase(), tag.id]),
    );
    const tagId = (raw: string): string | null => {
      const name = clip(raw, TAG_NAME_MAX_LENGTH);
      if (!name) return null;
      const key = name.toLocaleLowerCase();
      let id = tagIds.get(key);
      if (!id) {
        id = tags.create({ name }).id;
        tagIds.set(key, id);
      }
      return id;
    };

    const rootId = create(
      null,
      clip(scan.folderName, TITLE_MAX_LENGTH),
      'generic',
    );
    const folderIds = new Map<string, string>([['.', rootId]]);
    for (const folder of foldersWithNotes(scan)) {
      const parent = folderIds.get(path.posix.dirname(folder)) ?? rootId;
      folderIds.set(
        folder,
        create(
          parent,
          clip(path.posix.basename(folder), TITLE_MAX_LENGTH),
          'generic',
        ),
      );
    }

    // Tous les nœuds d'abord : les liens visent des notes pas encore écrites.
    const noteIds = new Map<ScannedNote, string>();
    for (const note of scan.notes) {
      const parent = folderIds.get(path.posix.dirname(note.path)) ?? rootId;
      const id = create(parent, note.title, note.meta?.nodeType ?? 'generic');
      noteIds.set(note, id);
      if (note.meta?.summary) {
        nodes.update({
          id,
          summary: clip(note.meta.summary, SUMMARY_MAX_LENGTH),
        });
      }
      const ids = (note.meta?.tags ?? [])
        .map(tagId)
        .filter((tag): tag is string => tag !== null);
      if (ids.length > 0) nodes.setTags({ id, tagIds: [...new Set(ids)] });
    }

    let documentCount = 0;
    for (const note of scan.notes) {
      const entries = analysis.resolutions.get(note) ?? [];
      const body = rewriteVaultLinks(
        note.body,
        entries.map((entry) => entry.link),
        (link) => {
          const resolution = entries.find((e) => e.link === link)!.resolution;
          switch (resolution.kind) {
            case 'note':
              return formatNodeLink(
                noteIds.get(resolution.note)!,
                resolution.text,
              );
            case 'existing':
              return formatNodeLink(resolution.id, resolution.text);
            case 'file':
              return `*Pièce jointe : ${path.posix.basename(resolution.file)}*`;
            case 'unresolved':
              return resolution.text;
            case 'keep':
              return null;
          }
        },
      );
      if (!body.trim()) continue;
      const document = documents.create({
        nodeId: noteIds.get(note)!,
        title: note.title,
        contentType: 'markdown',
      });
      documents.update({ id: document.id, body });
      documentCount++;
    }

    let attachmentCount = 0;
    for (const [file, note] of analysis.attachments) {
      const absolute = path.join(scan.root, ...file.split('/'));
      // Remplacé par un lien symbolique depuis l'aperçu : ignoré.
      if (!fs.lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) {
        analysis.skipped.push({
          path: file,
          reason: 'pièce jointe introuvable',
        });
        continue;
      }
      attachmentService.addFromPaths(noteIds.get(note)!, [absolute]);
      attachmentCount++;
    }

    // Relations « est lié à » créées par l'écriture des documents.
    const count = ctx.db.prepare(
      'SELECT count(*) AS n FROM edge WHERE source_node_id = ? AND from_link = 1',
    );
    let relationCount = 0;
    for (const id of noteIds.values()) {
      relationCount += (count.get(id) as { n: number }).n;
    }

    return {
      rootId,
      // Racine et dossiers (folderIds), puis notes.
      nodeCount: folderIds.size + noteIds.size,
      documentCount,
      attachmentCount,
      relationCount,
      unresolvedCount: analysis.unresolved.length,
      unresolved: capped(analysis.unresolved),
      skippedCount: analysis.skipped.length,
      skipped: capped(analysis.skipped),
      backupPath,
    };
  });
}
