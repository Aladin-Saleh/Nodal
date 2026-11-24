/**
 * Mémoire de travail : ce qu'ont donné les recherches passées d'un assistant
 * (utile, impasse, corrigé), et ce qu'on peut en conclure pour un nœud.
 * Logique pure, déterministe pour une date donnée.
 */
export const LESSON_OUTCOMES = ['useful', 'dead_end', 'corrected'] as const;
export type LessonOutcome = (typeof LESSON_OUTCOMES)[number];

export const LESSON_OUTCOME_LABELS: Record<LessonOutcome, string> = {
  useful: 'utile',
  dead_end: 'impasse',
  corrected: 'corrigé',
};

/** Le poids d'une leçon est divisé par deux tous les 30 jours. */
export const LESSON_HALF_LIFE_DAYS = 30;
/** Leçons « utile » distinctes pour qu'un nœud soit tenu pour sûr. */
export const LESSON_MIN_CONFIRMATIONS = 2;
export const LESSON_QUESTION_MAX_LENGTH = 300;
export const LESSON_NOTE_MAX_LENGTH = 1000;
export const LESSON_NODES_MAX = 10;

export interface Lesson {
  id: string;
  createdAt: string;
  client: string | null;
  outcome: LessonOutcome;
  question: string;
  /** Question sans accents ni casse. */
  key: string;
  note: string | null;
  nodes: { id: string; title: string }[];
  /** Le code ancré à l'un de ses nœuds a changé depuis : à revérifier. */
  stale: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Poids d'une leçon (0 à 1] ; date illisible ou future : 1. */
export function lessonWeight(createdAt: string, now: Date): number {
  const age = now.getTime() - new Date(createdAt).getTime();
  if (Number.isNaN(age) || age <= 0) return 1;
  return 0.5 ** (age / DAY_MS / LESSON_HALF_LIFE_DAYS);
}

/**
 * `trusted` : confirmé plusieurs fois, jamais contredit. `tentative` : utile
 * une fois. `contested` : avis contraires, le plus récent pèse le plus.
 * `negative` : impasses ou corrections seulement.
 */
export interface NodeVerdict {
  status: 'trusted' | 'tentative' | 'contested' | 'negative';
  useful: number;
  negative: number;
  score: number;
}

/**
 * Bilan d'un nœud. Une même question notée plusieurs fois le même jour ne
 * compte qu'une fois : répéter n'est pas confirmer. Une leçon périmée ne
 * compte plus.
 */
export function nodeVerdict(
  lessons: readonly Pick<Lesson, 'createdAt' | 'outcome' | 'key' | 'stale'>[],
  now: Date,
): NodeVerdict | null {
  const seen = new Set<string>();
  let useful = 0;
  let negative = 0;
  let score = 0;
  for (const lesson of lessons) {
    if (lesson.stale) continue;
    const positive = lesson.outcome === 'useful';
    const event = `${positive}|${lesson.key}|${lesson.createdAt.slice(0, 10)}`;
    if (seen.has(event)) continue;
    seen.add(event);
    if (positive) useful++;
    else negative++;
    score += (positive ? 1 : -1) * lessonWeight(lesson.createdAt, now);
  }
  if (useful + negative === 0) return null;
  let status: NodeVerdict['status'];
  if (useful > 0 && negative > 0) status = 'contested';
  else if (negative > 0) status = 'negative';
  else status = useful >= LESSON_MIN_CONFIRMATIONS ? 'trusted' : 'tentative';
  return { status, useful, negative, score: Math.round(score * 1e6) / 1e6 };
}

/**
 * Une leçon par question et par issue (la plus récente) ; une question
 * résolue depuis (« utile » plus récent) n'est plus une impasse. Les plus
 * récentes d'abord.
 */
export function currentLessons(lessons: readonly Lesson[]): Lesson[] {
  const sorted = lessons.toSorted((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const seen = new Set<string>();
  const solved = new Set<string>();
  return sorted.filter((lesson) => {
    const event = `${lesson.outcome}|${lesson.key}`;
    if (seen.has(event)) return false;
    seen.add(event);
    if (lesson.outcome === 'useful') solved.add(lesson.key);
    else if (lesson.outcome === 'dead_end' && solved.has(lesson.key))
      return false;
    return true;
  });
}
