/**
 * Découpage des documents en fragments (« chunks ») pour un usage LLM
 * (§6.7). Le découpage respecte la structure du contenu :
 * - Markdown : sections par titres, puis paragraphes ; tableaux découpés
 *   ligne à ligne en répétant l'en-tête ; blocs de code gardés entiers ;
 * - code : blocs logiques séparés par une ligne vide suivie d'une ligne non
 *   indentée (fonctions, classes) ; SQL : instructions terminées par « ; » ;
 * - JSON : une entrée par clé ou élément de premier niveau (chemin JSON) ;
 * - Mermaid : un diagramme reste une unité ;
 * - texte : paragraphes.
 * Les tailles sont mesurées en tokens par le compteur fourni.
 */
import type { ContentType } from '../../shared/domain';

/** Version de la stratégie : à incrémenter à chaque changement de découpage. */
export const CHUNK_STRATEGY_VERSION = 1;

export type TokenCounter = (text: string) => number;

export interface ChunkPiece {
  content: string;
  /** Contexte structurel : titres Markdown ou chemin JSON. */
  section: string | null;
}

interface Block {
  text: string;
  section: string | null;
  /** Bloc indivisible (diagramme, bloc de code délimité). */
  atomic?: boolean;
}

/** Regroupe des blocs consécutifs tant que la limite n'est pas dépassée. */
function pack(
  blocks: Block[],
  maxTokens: number,
  count: TokenCounter,
): ChunkPiece[] {
  const pieces: ChunkPiece[] = [];
  let current: Block[] = [];
  let currentTokens = 0;
  const flush = () => {
    if (current.length === 0) return;
    pieces.push({
      content: current.map((block) => block.text).join('\n\n'),
      section: current[0]!.section,
    });
    current = [];
    currentTokens = 0;
  };
  for (const block of blocks) {
    const tokens = count(block.text);
    if (tokens > maxTokens && !block.atomic) {
      flush();
      for (const piece of splitLines(block, maxTokens, count))
        pieces.push(piece);
      continue;
    }
    const sameSection =
      current.length === 0 || current[0]!.section === block.section;
    if (
      current.length > 0 &&
      (currentTokens + tokens > maxTokens || !sameSection)
    ) {
      flush();
    }
    current.push(block);
    currentTokens += tokens;
  }
  flush();
  return pieces;
}

/** Dernier recours : découpe un bloc trop long ligne à ligne. */
function splitLines(
  block: Block,
  maxTokens: number,
  count: TokenCounter,
): ChunkPiece[] {
  const pieces: ChunkPiece[] = [];
  let lines: string[] = [];
  for (const line of block.text.split('\n')) {
    const candidate = [...lines, line].join('\n');
    if (lines.length > 0 && count(candidate) > maxTokens) {
      pieces.push({ content: lines.join('\n'), section: block.section });
      lines = [];
    }
    lines.push(line);
  }
  if (lines.length > 0)
    pieces.push({ content: lines.join('\n'), section: block.section });
  return pieces;
}

function paragraphs(text: string, section: string | null): Block[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, section }));
}

/** Tableau Markdown trop long : découpé en conservant l'en-tête. */
function splitTable(
  lines: string[],
  maxTokens: number,
  count: TokenCounter,
  section: string | null,
): Block[] {
  const header = lines.slice(0, 2);
  const rows = lines.slice(2);
  const blocks: Block[] = [];
  let current: string[] = [];
  for (const row of rows) {
    const candidate = [...header, ...current, row].join('\n');
    if (current.length > 0 && count(candidate) > maxTokens) {
      blocks.push({
        text: [...header, ...current].join('\n'),
        section,
        atomic: true,
      });
      current = [];
    }
    current.push(row);
  }
  if (current.length > 0 || rows.length === 0) {
    blocks.push({
      text: [...header, ...current].join('\n'),
      section,
      atomic: true,
    });
  }
  return blocks;
}

function markdownBlocks(
  body: string,
  maxTokens: number,
  count: TokenCounter,
): Block[] {
  const blocks: Block[] = [];
  const headings: string[] = [];
  let section: string | null = null;
  let buffer: string[] = [];
  const flushText = () => {
    blocks.push(...paragraphs(buffer.join('\n'), section));
    buffer = [];
  };
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushText();
      const level = heading[1]!.length;
      headings.length = level - 1;
      headings[level - 1] = heading[2]!.trim();
      section = headings.filter(Boolean).join(' > ');
      buffer.push(line);
      continue;
    }
    if (/^(```|~~~)/.test(line)) {
      flushText();
      const fence = line.slice(0, 3);
      const code = [line];
      while (++i < lines.length) {
        code.push(lines[i]!);
        if (lines[i]!.startsWith(fence)) break;
      }
      blocks.push({
        text: code.join('\n'),
        section,
        atomic: count(code.join('\n')) <= maxTokens,
      });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      flushText();
      const table = [line];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1]!))
        table.push(lines[++i]!);
      blocks.push(...splitTable(table, maxTokens, count, section));
      continue;
    }
    buffer.push(line);
  }
  flushText();
  return blocks;
}

function codeBlocks(body: string, language: string | null): Block[] {
  if (language === 'sql') {
    return body
      .split(/;\s*\n/)
      .map((statement, index, all) =>
        index < all.length - 1 ? `${statement.trim()};` : statement.trim(),
      )
      .filter((statement) => statement.length > 0 && statement !== ';')
      .map((statement) => ({ text: statement, section: null }));
  }
  // Une ligne vide suivie d'une ligne non indentée ouvre un nouveau bloc.
  return body
    .split(/\n\s*\n(?=\S)/)
    .map((part) => part.replace(/\s+$/, ''))
    .filter((part) => part.trim().length > 0)
    .map((part) => ({ text: part, section: null }));
}

function jsonBlocks(body: string): Block[] | null {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      text: JSON.stringify(item, null, 2),
      section: `$[${index}]`,
    }));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) => ({
      text: `${JSON.stringify(key)}: ${JSON.stringify(item, null, 2)}`,
      section: `$.${key}`,
    }));
  }
  return [{ text: body.trim(), section: '$' }];
}

/** Découpe un document en fragments d'au plus `maxTokens` (sauf unité indivisible). */
export function chunkDocument(
  body: string,
  contentType: ContentType,
  language: string | null,
  maxTokens: number,
  count: TokenCounter,
): ChunkPiece[] {
  if (body.trim().length === 0) return [];
  switch (contentType) {
    case 'mermaid':
      // Un diagramme découpé perdrait son sens : il reste entier.
      return [{ content: body.trim(), section: null }];
    case 'markdown':
      return pack(markdownBlocks(body, maxTokens, count), maxTokens, count);
    case 'code':
      return pack(codeBlocks(body, language), maxTokens, count);
    case 'json': {
      const blocks = jsonBlocks(body);
      if (!blocks) return pack(paragraphs(body, null), maxTokens, count);
      // Une entrée par clé : pas de regroupement entre chemins différents.
      return blocks.flatMap((block) =>
        count(block.text) > maxTokens
          ? splitLines(block, maxTokens, count)
          : [{ content: block.text, section: block.section }],
      );
    }
    case 'text':
      return pack(paragraphs(body, null), maxTokens, count);
  }
}
