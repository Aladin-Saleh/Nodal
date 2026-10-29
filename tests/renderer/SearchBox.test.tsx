// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import {
  renderSnippet,
  SearchBox,
} from '../../src/renderer/features/search/SearchBox';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import type { SearchHit } from '../../src/shared/model';

afterEach(cleanup);

const hits: SearchHit[] = [
  {
    nodeId: 'n1',
    nodeTitle: 'Kafka',
    nodeType: 'component',
    matches: [
      {
        kind: 'document',
        documentId: 'd1',
        documentTitle: 'Topics',
        snippet: 'le \u0002topic\u0003 order-events',
      },
    ],
  },
];

function setup() {
  const call = vi.fn(async () => hits);
  const client = {
    call,
    onFlushRequest: () => () => undefined,
  } as unknown as NodalClient;
  const onResults = vi.fn();
  const onSelectNode = vi.fn();
  const onOpenDocument = vi.fn();
  render(
    <ServicesProvider
      client={client}
      tracker={new SaveTracker(() => undefined)}
      reportError={vi.fn()}
      reportInfo={vi.fn()}
    >
      <SearchBox
        onResults={onResults}
        onSelectNode={onSelectNode}
        onOpenDocument={onOpenDocument}
      />
    </ServicesProvider>,
  );
  return { call, onResults, onSelectNode, onOpenDocument };
}

describe('renderSnippet', () => {
  it('met en surbrillance les termes trouvés sans interpréter de HTML', () => {
    const { container } = render(
      <p>{renderSnippet('<b>x</b> \u0002kafka\u0003 et \u0002topic\u0003')}</p>,
    );
    expect(container.querySelectorAll('mark')).toHaveLength(2);
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toBe('<b>x</b> kafka et topic');
  });
});

describe('SearchBox', () => {
  it('interroge l’index, affiche les résultats et sélectionne un nœud', async () => {
    const { call, onResults, onSelectNode } = setup();
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'topic' },
    });

    expect(await screen.findByText('1 nœud')).toBeTruthy();
    expect(call).toHaveBeenCalledWith('search:query', { query: 'topic' });
    expect(onResults).toHaveBeenLastCalledWith(hits);

    fireEvent.click(screen.getByText('Kafka'));
    expect(onSelectNode).toHaveBeenCalledWith('n1');
  });

  it('ouvre le document d’un extrait trouvé', async () => {
    const { onOpenDocument } = setup();
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'topic' },
    });
    fireEvent.click(await screen.findByText('Topics'));
    expect(onOpenDocument).toHaveBeenCalledWith('d1', 'n1');
  });

  it('Échap vide la recherche et retire la mise en évidence', async () => {
    const { onResults } = setup();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'topic' } });
    await screen.findByText('1 nœud');
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Escape' });
    await vi.waitFor(() => expect(onResults).toHaveBeenLastCalledWith(null));
    expect((input as HTMLInputElement).value).toBe('');
  });
});
