/**
 * Export vers un coffre Obsidian : une note Markdown par nœud, rangée comme
 * l'arborescence, avec ses documents, ses relations et ses pièces jointes.
 * Toujours dans un nouveau dossier : aucun fichier existant n'est touché.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ContentType, NodeType } from '../../shared/domain';
import type { WorkspaceInfo } from '../../shared/ipc-contract';
import type { VaultExportResult } from '../../shared/model';
import { resolveTarget, rewriteWikiLinks } from '../../shared/wiki-links';
import type { ServiceContext } from './context';
import { listEdges } from './edge-service';
import {
  documentExtension,
  safeFileName,
  timestampForPath,
  writeFileDeep,
} from './export-service';
import { workspaceLinkResolver } from './link-service';
import { listRelationTypes } from './relation-type-service';
import { asRows } from './rows';

/** Longueur d'un nom : le chemin doit tenir sous Windows (260 caractères). */
const NAME_MAX_LENGTH = 60;
const ATTACHMENTS_FOLDER = 'Pièces jointes';

/** Nom de note : caractères interdits par Windows et par les liens Obsidian. */
export function noteName(title: string): string {
  const cleaned = title
    .replace(/[[\]#^|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.(?:md|markdown)$/i, '')
    // Obsidian masque les noms qui commencent par un point.
    .replace(/^[.\s]+/, '');
  return (
    safeFileName(cleaned, 'Sans titre')
      .slice(0, NAME_MAX_LENGTH)
      .replace(/[. ]+$/, '') || 'Sans titre'
  );
}

/** Noms uniques sans distinction de casse (Windows, macOS). */
function uniqueNames() {
  const used = new Set<string>();
  return (wanted: string): string => {
    const { name, ext } = path.parse(wanted);
    let candidate = wanted;
    for (let n = 2; used.has(candidate.toLowerCase()); n++)
      candidate = `${name} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

/** Étiquette Obsidian : lettres, chiffres, `-`, `_`, `/` ; pas que des chiffres. */
export function vaultTag(name: string): string {
  const tag = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_/-]/gu, '');
  if (!/[\p{L}\p{N}]/u.test(tag)) return 'sans-nom';
  return /^\d+$/.test(tag) ? `n${tag}` : tag;
}

/** Chaîne YAML entre guillemets, sur une ligne. */
const yaml = (value: string) =>
  `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim()}"`;

/** Bloc de code dont la clôture est plus longue que celles du contenu. */
function fenced(body: string, language: string): string {
  const longest = Math.max(
    2,
    ...[...body.matchAll(/`{3,}/g)].map((match) => match[0].length),
  );
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${body.replace(/\n$/, '')}\n${fence}`;
}

export async function exportVault(
  ctx: ServiceContext,
  workspace: Pick<WorkspaceInfo, 'name'>,
  parentDir: string,
): Promise<VaultExportResult> {
  const { db, workspaceId } = ctx;
  const nodes = asRows<{
    id: string;
    parent_id: string | null;
    title: string;
    node_type: NodeType;
    summary: string | null;
  }>(
    db
      .prepare(
        `SELECT id, parent_id, title, node_type, summary FROM node
         WHERE workspace_id = ? ORDER BY sort_order, rowid`,
      )
      .all(workspaceId),
  );
  const documents = asRows<{
    node_id: string;
    title: string;
    content_type: ContentType;
    language: string | null;
    body: string;
  }>(
    db
      .prepare(
        `SELECT d.node_id, d.title, d.content_type, d.language, d.body
         FROM document d JOIN node n ON n.id = d.node_id
         WHERE n.workspace_id = ? ORDER BY d.sort_order, d.rowid`,
      )
      .all(workspaceId),
  );
  const tags = asRows<{ node_id: string; name: string }>(
    db
      .prepare(
        `SELECT nt.node_id, t.name FROM node_tag nt JOIN tag t ON t.id = nt.tag_id
         WHERE t.workspace_id = ? ORDER BY t.name`,
      )
      .all(workspaceId),
  );
  const attachments = asRows<{ id: string; node_id: string; name: string }>(
    db
      .prepare(
        `SELECT a.id, coalesce(a.node_id, d.node_id) AS node_id, a.file_name AS name
         FROM attachment a LEFT JOIN document d ON d.id = a.document_id
         JOIN node n ON n.id = coalesce(a.node_id, d.node_id)
         WHERE n.workspace_id = ? ORDER BY a.rowid`,
      )
      .all(workspaceId),
  );
  const edges = listEdges(ctx);
  const typeName = new Map(
    listRelationTypes(ctx).map((type) => [type.id, type.name]),
  );
  const resolver = workspaceLinkResolver(ctx);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parents = new Set(nodes.map((node) => node.parent_id));

  // Nom unique dans tout le coffre : un lien Obsidian ne cite que le nom.
  const unique = uniqueNames();
  const names = new Map(
    nodes.map((node) => [node.id, unique(noteName(node.title))]),
  );
  const folderOf = (id: string): string[] => {
    const folders: string[] = [];
    const seen = new Set<string>();
    // Un nœud qui a des enfants a son dossier, avec sa note dedans.
    let current = parents.has(id) ? id : byId.get(id)!.parent_id;
    while (current !== null && byId.has(current) && !seen.has(current)) {
      seen.add(current);
      folders.unshift(names.get(current)!);
      current = byId.get(current)!.parent_id;
    }
    return folders;
  };
  const linkTo = (id: string, text?: string | null) => {
    const name = names.get(id)!;
    const shown = (text ?? byId.get(id)!.title)
      .replace(/[[\]|\n]/g, ' ')
      .trim();
    return shown === name ? `[[${name}]]` : `[[${name}|${shown}]]`;
  };
  const attachmentName = uniqueNames();
  const attachmentFiles = new Map(
    attachments.map((file) => [
      file.id,
      attachmentName(safeFileName(file.name, 'fichier')),
    ]),
  );

  const base = `${safeFileName(workspace.name, 'espace')}-obsidian-${timestampForPath(ctx.now())}`;
  let folderPath = path.join(parentDir, base);
  for (let n = 2; fs.existsSync(folderPath); n++)
    folderPath = path.join(parentDir, `${base}-${n}`);
  const partial = `${folderPath}.partial`;
  fs.rmSync(partial, { recursive: true, force: true });

  const note = (node: (typeof nodes)[number]): string => {
    const own = <T extends { node_id: string }>(rows: T[]) =>
      rows.filter((row) => row.node_id === node.id);
    const tagNames = [...new Set(own(tags).map((tag) => vaultTag(tag.name)))];
    const parts = [
      [
        '---',
        `title: ${yaml(node.title)}`,
        `type: ${node.node_type}`,
        ...(node.summary?.trim() ? [`summary: ${yaml(node.summary)}`] : []),
        ...(tagNames.length > 0 ? [`tags: [${tagNames.join(', ')}]`] : []),
        `nodal-id: ${node.id}`,
        '---',
      ].join('\n'),
    ];
    if (node.summary?.trim()) parts.push(node.summary.trim());
    for (const doc of own(documents)) {
      const body =
        doc.content_type === 'markdown'
          ? rewriteWikiLinks(doc.body, (link) => {
              const id = resolveTarget(link.target, resolver);
              return id && names.has(id) ? linkTo(id, link.text) : null;
            }).trim()
          : doc.content_type === 'text'
            ? doc.body.trim()
            : fenced(
                doc.body,
                doc.content_type === 'code'
                  ? (doc.language ?? '')
                  : doc.content_type === 'mermaid'
                    ? 'mermaid'
                    : documentExtension(doc.content_type, doc.language),
              );
      parts.push(`## ${doc.title.replace(/\s+/g, ' ')}`, body);
    }
    const relations = edges
      .filter((edge) => edge.sourceId === node.id && names.has(edge.targetId))
      .map(
        (edge) =>
          `- ${edge.label ?? typeName.get(edge.relationTypeId) ?? 'relation'} ${linkTo(edge.targetId)}`,
      );
    if (relations.length > 0) parts.push('## Relations', relations.join('\n'));
    const files = own(attachments).map(
      (file) => `- [[${attachmentFiles.get(file.id)}]]`,
    );
    if (files.length > 0) parts.push('## Pièces jointes', files.join('\n'));
    return `${parts.filter(Boolean).join('\n\n')}\n`;
  };

  try {
    await fs.promises.mkdir(partial, { recursive: true });
    for (const node of nodes) {
      await writeFileDeep(
        path.join(partial, ...folderOf(node.id), `${names.get(node.id)}.md`),
        note(node),
      );
    }
    const read = db.prepare('SELECT data FROM attachment WHERE id = ?');
    for (const file of attachments) {
      const { data } = read.get(file.id) as { data: Uint8Array };
      await writeFileDeep(
        path.join(partial, ATTACHMENTS_FOLDER, attachmentFiles.get(file.id)!),
        data,
      );
    }
    await fs.promises.rename(partial, folderPath);
  } catch (error) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw error;
  }
  return {
    folderPath,
    noteCount: nodes.length,
    attachmentCount: attachments.length,
  };
}
