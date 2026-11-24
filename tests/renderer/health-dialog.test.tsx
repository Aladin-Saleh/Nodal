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
import { HealthDialog } from '../../src/renderer/features/workspace/HealthDialog';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import type { HealthReport } from '../../src/shared/model';

afterEach(cleanup);

const report: HealthReport = {
  checks: [
    {
      id: 'brokenLink',
      label: 'Liens [[…]] cassés',
      count: 3,
      issues: [
        {
          check: 'brokenLink',
          nodeId: 'n1',
          title: 'API',
          documentId: 'd1',
          documentTitle: 'Notes',
          detail: 'Inconnu',
        },
      ],
    },
    {
      id: 'duplicate',
      label: 'Doublons probables',
      count: 1,
      issues: [
        {
          check: 'duplicate',
          nodeId: 'n1',
          title: 'API',
          otherNodeId: 'n2',
          detail: 'api',
        },
      ],
    },
    { id: 'orphan', label: 'Nœuds isolés', count: 0, issues: [] },
    {
      id: 'stale',
      label: 'Documentation possiblement obsolète',
      count: 1,
      issues: [
        {
          check: 'stale',
          nodeId: 'n3',
          title: 'Serveur MCP',
          detail: 'src/mcp/server.ts',
        },
      ],
    },
  ],
  questions: [],
  gaps: [
    {
      key: 'rollback',
      query: 'Rollback',
      count: 2,
      firstAt: '2026-10-30T10:00:00.000Z',
      lastAt: '2026-10-31T10:00:00.000Z',
      status: 'open',
    },
  ],
};

function setup(focus: 'all' | 'gaps' = 'all') {
  const call = vi.fn(async (channel: string) =>
    channel === 'health:report' ? report : null,
  );
  const props = {
    onClose: vi.fn(),
    onOpenNode: vi.fn(),
    onOpenDocument: vi.fn(),
    onValidate: vi.fn(),
    onMerge: vi.fn(),
    onCodeAnchorsChanged: vi.fn(),
    onCreateFromGap: vi.fn(),
  };
  render(
    <ServicesProvider
      client={{ call } as unknown as NodalClient}
      tracker={new SaveTracker(() => undefined)}
      reportError={vi.fn()}
      reportInfo={vi.fn()}
    >
      <HealthDialog focus={focus} {...props} />
    </ServicesProvider>,
  );
  return { call, ...props };
}

describe('HealthDialog', () => {
  it('montre compteurs et lignes, chacune avec son action', async () => {
    const { onOpenDocument, onOpenNode } = setup();
    const broken = await screen.findByRole('region', {
      name: 'Liens [[…]] cassés',
    });
    expect(within(broken).getByText('3')).toBeTruthy();
    expect(within(broken).getByText('… et 2 autres.')).toBeTruthy();
    fireEvent.click(
      within(broken).getByRole('button', { name: 'Ouvrir le document' }),
    );
    expect(onOpenDocument).toHaveBeenCalledWith('d1', 'n1');
    const duplicates = screen.getByRole('region', {
      name: 'Doublons probables',
    });
    fireEvent.click(
      within(duplicates).getByRole('button', { name: 'Ouvrir l’autre' }),
    );
    expect(onOpenNode).toHaveBeenCalledWith('n2');
  });

  it('sujets à documenter : créer un nœud ou ignorer', async () => {
    const { call, onCreateFromGap } = setup('gaps');
    const gaps = await screen.findByRole('region', {
      name: 'Sujets à documenter',
    });
    expect(within(gaps).getByText('« Rollback »')).toBeTruthy();
    fireEvent.click(
      within(gaps).getByRole('button', { name: 'Créer un nœud' }),
    );
    expect(onCreateFromGap).toHaveBeenCalledWith(report.gaps[0]);
    fireEvent.click(within(gaps).getByRole('button', { name: 'Ignorer' }));
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('gap:setStatus', {
        key: 'rollback',
        status: 'ignored',
      }),
    );
  });

  it('documentation obsolète : marquer comme à jour', async () => {
    const { call, onCodeAnchorsChanged } = setup();
    const stale = await screen.findByRole('region', {
      name: 'Documentation possiblement obsolète',
    });
    expect(within(stale).getByText(/src\/mcp\/server\.ts/)).toBeTruthy();
    fireEvent.click(
      within(stale).getByRole('button', { name: 'Marquer comme à jour' }),
    );
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('anchor:markReviewed', { id: 'n3' }),
    );
    await vi.waitFor(() => expect(onCodeAnchorsChanged).toHaveBeenCalled());
  });
});
