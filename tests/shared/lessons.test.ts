import { describe, expect, it } from 'vitest';
import {
  currentLessons,
  lessonWeight,
  nodeVerdict,
  type Lesson,
  type LessonOutcome,
} from '../../src/shared/lessons';

const NOW = new Date('2026-11-30T12:00:00.000Z');
const lesson = (
  outcome: LessonOutcome,
  key: string,
  day: string,
  stale = false,
): Lesson => ({
  id: `${outcome}${key}${day}`,
  createdAt: `${day}T10:00:00.000Z`,
  client: null,
  outcome,
  question: key,
  key,
  note: null,
  nodes: [],
  stale,
});

describe('poids d’une leçon', () => {
  it('est divisé par deux tous les 30 jours', () => {
    expect(lessonWeight('2026-11-30T12:00:00.000Z', NOW)).toBe(1);
    expect(lessonWeight('2026-10-31T12:00:00.000Z', NOW)).toBeCloseTo(0.5);
    // Date future (autre fuseau, horloge) ou illisible : poids entier.
    expect(lessonWeight('2027-01-01T00:00:00.000Z', NOW)).toBe(1);
    expect(lessonWeight('?', NOW)).toBe(1);
  });
});

describe('bilan d’un nœud', () => {
  const status = (...list: Lesson[]) => nodeVerdict(list, NOW)?.status;

  it('deux questions utiles, ou deux jours, pour être sûr', () => {
    const one = lesson('useful', 'a', '2026-11-29');
    expect(status(one)).toBe('tentative');
    // Répéter la même question le même jour n'est pas confirmer.
    expect(status(one, lesson('useful', 'a', '2026-11-29'))).toBe('tentative');
    expect(status(one, lesson('useful', 'b', '2026-11-29'))).toBe('trusted');
    expect(status(one, lesson('useful', 'a', '2026-11-28'))).toBe('trusted');
  });

  it('avis contraires : le plus récent pèse le plus', () => {
    const verdict = nodeVerdict(
      [
        lesson('useful', 'a', '2026-06-01'),
        lesson('useful', 'b', '2026-06-01'),
        lesson('dead_end', 'c', '2026-11-29'),
      ],
      NOW,
    )!;
    expect(verdict).toMatchObject({
      status: 'contested',
      useful: 2,
      negative: 1,
    });
    expect(verdict.score).toBeLessThan(0);
    expect(status(lesson('corrected', 'a', '2026-11-29'))).toBe('negative');
  });

  it('une leçon périmée ne compte plus', () => {
    expect(
      nodeVerdict([lesson('useful', 'a', '2026-11-29', true)], NOW),
    ).toBeNull();
  });
});

describe('leçons en vigueur', () => {
  it('la plus récente par question et issue ; résolue, plus une impasse', () => {
    const list = currentLessons([
      lesson('dead_end', 'a', '2026-11-01'),
      lesson('dead_end', 'a', '2026-11-02'),
      lesson('useful', 'a', '2026-11-03'),
      lesson('dead_end', 'b', '2026-11-04'),
      lesson('useful', 'b', '2026-11-03'),
      lesson('corrected', 'a', '2026-11-01'),
    ]);
    expect(list.map((item) => item.id)).toEqual([
      'dead_endb2026-11-04',
      'usefula2026-11-03',
      'usefulb2026-11-03',
      'correcteda2026-11-01',
    ]);
  });
});
