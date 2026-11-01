// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import { CodeAnchorList } from '../../src/renderer/features/nodes/CodeAnchorList';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import type { NodeAnchors } from '../../src/shared/code-anchors';

afterEach(cleanup);

const anchors: NodeAnchors = {
  hasRoots: true,
  anchors: [
    {
      pattern: 'src/mcp/**',
      files: ['src/mcp/server.ts', 'src/mcp/tools.ts'],
      count: 2,
      truncated: false,
    },
    { pattern: 'src/old.ts', files: [], count: 0, truncated: false },
  ],
  stale: {
    nodeId: 'n1',
    since: '2026-10-01T10:00:00.000Z',
    files: [
      { path: 'src/mcp/server.ts', changedAt: '2026-10-20T10:00:00.000Z' },
    ],
    fileCount: 1,
    source: 'git',
  },
};

function setup(state: NodeAnchors = anchors) {
  const call = vi.fn(async (channel: string, input?: unknown) => {
    if (channel === 'anchor:listForNode') return state;
    if (channel === 'anchor:set') {
      return (input as { patterns: string[] }).patterns;
    }
    return null;
  });
  const onChanged = vi.fn();
  render(
    <ServicesProvider
      client={{ call } as unknown as NodalClient}
      tracker={new SaveTracker(() => undefined)}
      reportError={vi.fn()}
      reportInfo={vi.fn()}
    >
      <CodeAnchorList nodeId="n1" revision={0} onChanged={onChanged} />
    </ServicesProvider>,
  );
  return { call, onChanged };
}

describe('CodeAnchorList', () => {
  it('montre fichiers trouvés, introuvables et l’avertissement d’obsolescence', async () => {
    const { call, onChanged } = setup();
    const section = await screen.findByRole('region', {
      name: 'Fichiers du code',
    });
    expect(within(section).getByText('2 fichiers')).toBeTruthy();
    expect(within(section).getByText('introuvable')).toBeTruthy();
    const warning = within(section).getByRole('status');
    expect(warning.textContent).toContain('1 fichier modifié');
    expect(within(warning).getByText('src/mcp/server.ts')).toBeTruthy();

    fireEvent.click(
      within(warning).getByRole('button', { name: 'Marquer comme à jour' }),
    );
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('anchor:markReviewed', { id: 'n1' }),
    );
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('ancre un motif saisi et en retire un', async () => {
    const { call } = setup();
    const input = await screen.findByLabelText('Fichier ou motif à ancrer');
    fireEvent.change(input, { target: { value: 'README.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ancrer' }));
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('anchor:set', {
        nodeId: 'n1',
        patterns: ['src/mcp/**', 'src/old.ts', 'README.md'],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retirer src/old.ts' }));
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('anchor:set', {
        nodeId: 'n1',
        patterns: ['src/mcp/**'],
      }),
    );
  });

  it('invite à déclarer un dossier de code', async () => {
    setup({ hasRoots: false, anchors: [], stale: null });
    expect(await screen.findByText(/Déclarez un dossier de code/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Choisir des fichiers…' }),
    ).toBeNull();
  });
});
