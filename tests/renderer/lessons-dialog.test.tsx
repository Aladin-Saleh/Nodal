// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import { LessonsDialog } from '../../src/renderer/features/workspace/LessonsDialog';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import type { Lesson } from '../../src/shared/lessons';

afterEach(cleanup);

const lesson = (id: string, day: string): Lesson => ({
  id,
  createdAt: `${day}T10:00:00.000Z`,
  client: 'claude-code',
  outcome: 'dead_end',
  question: 'Contourner le verrou',
  key: 'contourner le verrou',
  note: 'Impossible.',
  nodes: [{ id: 'n1', title: 'Terminal' }],
  stale: true,
});

it('montre une leçon par question ; la supprimer retire ses répétitions', async () => {
  let lessons = [lesson('l1', '2026-11-01'), lesson('l2', '2026-11-02')];
  const call = vi.fn(async (channel: string, input?: { id: string }) => {
    if (channel === 'lesson:list') return lessons;
    lessons = lessons.filter((item) => item.id !== input!.id);
    return null;
  });
  const onNavigate = vi.fn();
  render(
    <ServicesProvider
      client={{ call } as unknown as NodalClient}
      tracker={new SaveTracker(() => undefined)}
      reportError={vi.fn()}
      reportInfo={vi.fn()}
    >
      <LessonsDialog onNavigate={onNavigate} onClose={vi.fn()} />
    </ServicesProvider>,
  );
  expect(await screen.findAllByText('Impossible.')).toHaveLength(1);
  expect(screen.getByText('impasse')).toBeTruthy();
  expect(screen.getByText(/à revérifier/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
  expect(onNavigate).toHaveBeenCalledWith('n1');
  fireEvent.click(screen.getByRole('button', { name: /^Supprimer la leçon/ }));
  await waitFor(() =>
    expect(screen.getByText('Aucune leçon pour l’instant.')).toBeTruthy(),
  );
  expect(lessons).toEqual([]);
});
