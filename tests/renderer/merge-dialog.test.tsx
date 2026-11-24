// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import { MergeDialog } from '../../src/renderer/features/nodes/MergeDialog';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';

afterEach(cleanup);

it('propose un nœud à garder, modifiable avant de fusionner', async () => {
  const side = (id: string, title: string) => ({
    id,
    title,
    parentTitle: 'Architecture',
    hasSummary: true,
    documents: 2,
    chars: 10,
    relations: 1,
    children: 0,
    attachments: 0,
  });
  const call = vi.fn(async () => ({
    first: side('a', 'Serveur MCP'),
    second: side('b', 'serveur-mcp'),
    keepId: 'b',
  }));
  const onSubmit = vi.fn();
  render(
    <ServicesProvider
      client={{ call } as unknown as NodalClient}
      tracker={new SaveTracker(() => undefined)}
      reportError={vi.fn()}
      reportInfo={vi.fn()}
    >
      <MergeDialog
        firstId="a"
        secondId="b"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </ServicesProvider>,
  );
  expect(await screen.findByText(/« Serveur MCP »\) disparaît/)).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: /^Serveur MCP/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Fusionner' }));
  expect(onSubmit).toHaveBeenCalledWith('a', 'b');
});
