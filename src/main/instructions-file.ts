/**
 * Consignes « Nodal d'abord » dans le fichier d'instructions d'un projet
 * (CLAUDE.md, AGENTS.md…) : un bloc entre deux marques, ajouté à la fin, puis
 * remplacé sur place. Le reste du fichier n'est jamais modifié.
 */
import fs from 'node:fs';
import path from 'node:path';

const BEGIN = '<!-- nodal:début (bloc géré par Nodal) -->';
const END = '<!-- nodal:fin -->';
/** Titre du bloc, quand il a été collé à la main (sans marques). */
const PASTED = /^## Base de connaissances Nodal «/m;

/** Texte avec le bloc ; `null` : des consignes y sont déjà, à ne pas toucher. */
export function withInstructions(
  text: string,
  instructions: string,
): string | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const block = [BEGIN, instructions, END].join('\n').replaceAll(/\r?\n/g, eol);
  const start = text.indexOf(BEGIN);
  const end = start < 0 ? -1 : text.indexOf(END, start);
  if (end >= 0)
    return text.slice(0, start) + block + text.slice(end + END.length);
  // Marque de fin perdue : on ne sait plus ce qui est à l'utilisateur.
  if (start >= 0 || PASTED.test(text)) return null;
  if (text.trim() === '') return `${block}${eol}`;
  const gap = text.endsWith('\n') ? eol : eol + eol;
  return `${text}${gap}${block}${eol}`;
}

/** Écrit le bloc (fichier créé au besoin) ; `false` s'il n'y touche pas. */
export function installInstructions(
  file: string,
  instructions: string,
): boolean {
  // Lien symbolique (CLAUDE.md → AGENTS.md) : sa cible est modifiée.
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file;
  const text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const next = withInstructions(text, instructions);
  if (next === null) return false;
  if (next === text) return true;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.nodal.tmp`;
  try {
    fs.writeFileSync(temporary, next);
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return true;
}
