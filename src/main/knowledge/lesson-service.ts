/**
 * Mémoire de travail (shared/lessons.ts) : enregistrement et lecture des
 * leçons. Le code ancré est comparé à son état quand la leçon a été notée,
 * pas à celui d'un bilan ultérieur : un changement n'est jamais masqué.
 */
import path from 'node:path';
import {
  LESSON_NODES_MAX,
  LESSON_NOTE_MAX_LENGTH,
  LESSON_QUESTION_MAX_LENGTH,
  type Lesson,
  type LessonOutcome,
} from '../../shared/lessons';
import { NodalError } from '../../shared/errors';
import { redactSecrets } from '../../shared/secrets';
import { foldText } from '../../shared/text';
import { fileFingerprintSync } from '../code/fingerprint';
import { notFound, type ServiceContext } from './context';
import { asRows } from './rows';

/** Leçons gardées au plus : les plus anciennes sont oubliées au-delà. */
export const LESSON_LIMIT = 1000;
/**
 * Fichiers ancrés suivis au plus par nœud : au-delà, l'ancrage est trop large
 * pour que leur changement dise quelque chose de la leçon.
 */
export const LESSON_FILES_MAX = 60;

export const lessonKey = (question: string) =>
  foldText(question)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function recordLesson(
  ctx: ServiceContext,
  input: {
    question: string;
    outcome: LessonOutcome;
    nodeIds: readonly string[];
    note?: string;
    client: string | null;
  },
): string {
  const question = redactSecrets(input.question).trim();
  const note = redactSecrets(input.note ?? '').trim();
  if (!lessonKey(question)) {
    throw new NodalError('VALIDATION_ERROR', 'Question vide.');
  }
  if (
    question.length > LESSON_QUESTION_MAX_LENGTH ||
    note.length > LESSON_NOTE_MAX_LENGTH
  ) {
    throw new NodalError(
      'LIMIT_EXCEEDED',
      `Question : ${LESSON_QUESTION_MAX_LENGTH} caractères au plus ; précision : ${LESSON_NOTE_MAX_LENGTH}.`,
    );
  }
  if (input.outcome === 'corrected' && !note) {
    throw new NodalError(
      'VALIDATION_ERROR',
      'Une correction doit dire ce qui est juste (note).',
    );
  }
  const nodeIds = [...new Set(input.nodeIds)];
  if (nodeIds.length > LESSON_NODES_MAX) {
    throw new NodalError(
      'LIMIT_EXCEEDED',
      `${LESSON_NODES_MAX} nœuds au plus par leçon.`,
    );
  }
  if (nodeIds.length === 0 && input.outcome === 'useful') {
    throw new NodalError(
      'VALIDATION_ERROR',
      'Une leçon « utile » désigne les nœuds qui ont servi.',
    );
  }
  const exists = ctx.db.prepare(
    'SELECT 1 FROM node WHERE id = ? AND workspace_id = ?',
  );
  for (const id of nodeIds)
    if (!exists.get(id, ctx.workspaceId)) throw notFound(`Nœud ${id}`);

  const id = ctx.newId();
  ctx.db
    .prepare(
      `INSERT INTO lesson (id, workspace_id, created_at, client, outcome, question, question_key, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      ctx.workspaceId,
      ctx.now(),
      input.client,
      input.outcome,
      question,
      lessonKey(question),
      note || null,
    );
  const link = ctx.db.prepare(
    'INSERT INTO lesson_node (lesson_id, node_id) VALUES (?, ?)',
  );
  for (const nodeId of nodeIds) link.run(id, nodeId);
  ctx.db
    .prepare(
      `DELETE FROM lesson WHERE workspace_id = :ws AND id IN (
         SELECT id FROM lesson WHERE workspace_id = :ws
         ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET :keep)`,
    )
    .run({ ws: ctx.workspaceId, keep: LESSON_LIMIT });
  return id;
}

/** Empreintes du code d'un nœud quand la leçon a été notée. */
export function saveLessonFiles(
  ctx: ServiceContext,
  lessonId: string,
  nodeId: string,
  files: Readonly<Record<string, string>>,
): void {
  const count = Object.keys(files).length;
  if (count === 0 || count > LESSON_FILES_MAX) return;
  ctx.db
    .prepare(
      'UPDATE lesson_node SET files = ? WHERE lesson_id = ? AND node_id = ?',
    )
    .run(JSON.stringify(files), lessonId, nodeId);
}

export function deleteLesson(ctx: ServiceContext, id: string): void {
  const done = ctx.db
    .prepare('DELETE FROM lesson WHERE id = ? AND workspace_id = ?')
    .run(id, ctx.workspaceId);
  if (done.changes === 0) throw notFound('Leçon');
}

/** Un fichier suivi a changé ou disparu (dossier de code absent : inconnu). */
function filesChanged(
  json: string | null,
  roots: readonly string[],
  read: (file: string) => string | null,
): boolean {
  if (!json) return false;
  let files: Record<string, string>;
  try {
    files = JSON.parse(json) as Record<string, string>;
  } catch {
    return false;
  }
  return Object.entries(files).some(([key, known]) => {
    const name = key.slice(0, key.indexOf('/'));
    const root = roots.find((item) => path.basename(item) === name);
    if (!root) return false;
    const relative = key.slice(key.indexOf('/') + 1).split('/');
    // Base modifiée à la main : jamais de lecture hors du dossier de code.
    if (relative.includes('..')) return false;
    return read(path.join(root, ...relative)) !== known;
  });
}

interface LessonRow {
  id: string;
  created_at: string;
  client: string | null;
  outcome: LessonOutcome;
  question: string;
  question_key: string;
  note: string | null;
}

/**
 * Leçons de l'espace, les plus récentes d'abord. `keep` choisit avant la
 * vérification du code sur le disque (`roots` : dossiers de code).
 */
export function listLessons(
  ctx: ServiceContext,
  roots: readonly string[],
  keep: (lesson: Omit<Lesson, 'stale'>) => boolean = () => true,
): Lesson[] {
  const rows = asRows<LessonRow>(
    ctx.db
      .prepare(
        `SELECT id, created_at, client, outcome, question, question_key, note
         FROM lesson WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC`,
      )
      .all(ctx.workspaceId),
  );
  if (rows.length === 0) return [];
  const links = new Map<
    string,
    { id: string; title: string; files: string | null }[]
  >();
  for (const link of asRows<{
    lesson_id: string;
    id: string;
    title: string;
    files: string | null;
  }>(
    ctx.db
      .prepare(
        `SELECT l.lesson_id, n.id, n.title, l.files
         FROM lesson_node l JOIN node n ON n.id = l.node_id
         WHERE n.workspace_id = ? ORDER BY n.rowid`,
      )
      .all(ctx.workspaceId),
  )) {
    const list = links.get(link.lesson_id);
    if (list) list.push(link);
    else links.set(link.lesson_id, [link]);
  }
  const prints = new Map<string, string | null>();
  const read = (file: string) => {
    let value = prints.get(file);
    if (value === undefined) {
      value = fileFingerprintSync(file);
      prints.set(file, value);
    }
    return value;
  };
  return rows.flatMap((row) => {
    const linked = links.get(row.id) ?? [];
    const lesson = {
      id: row.id,
      createdAt: row.created_at,
      client: row.client,
      outcome: row.outcome,
      question: row.question,
      key: row.question_key,
      note: row.note,
      nodes: linked.map(({ id, title }) => ({ id, title })),
    };
    if (!keep(lesson)) return [];
    const stale = linked.some((link) => filesChanged(link.files, roots, read));
    return [{ ...lesson, stale }];
  });
}
