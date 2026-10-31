// @vitest-environment jsdom
import {
  CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import type { LinkNode } from '../../src/renderer/features/editor/node-links';
import {
  LiveNodeLinks,
  linkCompletions,
  wikiLinkExtension,
} from '../../src/renderer/features/editor/wiki-link-extension';
import { BacklinkList } from '../../src/renderer/features/nodes/BacklinkList';
import { SuggestionList } from '../../src/renderer/features/nodes/SuggestionList';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import {
  createLinkResolver,
  formatNodeLink,
} from '../../src/shared/wiki-links';

afterEach(cleanup);

const CACHE = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const nodes: LinkNode[] = [
  { id: CACHE, title: 'Cache Redis', path: 'Architecture' },
  { id: '11111111-2222-4333-8444-555555555555', title: 'Kafka', path: '' },
];
const live = new LiveNodeLinks({
  nodes,
  resolver: createLinkResolver(nodes),
  open: () => undefined,
  onLinksChanged: () => undefined,
  onDocumentSaved: () => undefined,
});

function editor(doc: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  return new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: wikiLinkExtension(live) }),
  });
}

describe('liens [[...]] dans l’éditeur', () => {
  it('propose les nœuds par titre ou chemin', () => {
    expect(linkCompletions('redis', nodes).map((n) => n.title)).toEqual([
      'Cache Redis',
    ]);
    expect(linkCompletions('archi', nodes).map((n) => n.title)).toEqual([
      'Cache Redis',
    ]);
    expect(linkCompletions('', nodes)).toHaveLength(2);
  });

  it('[[ ouvre l’autocomplétion ; le choix insère un lien par identifiant', () => {
    const view = editor('Voir [[cach]]');
    const pos = 'Voir [[cach'.length;
    const [source] = view.state.languageDataAt<
      (context: CompletionContext) => CompletionResult | null
    >('autocomplete', pos);
    const result = source!(new CompletionContext(view.state, pos, false))!;
    expect(result.from).toBe('Voir '.length);
    const option = result.options[0]!;
    expect(option.label).toBe('Cache Redis');
    (option.apply as (...args: unknown[]) => void)(
      view,
      option,
      result.from,
      pos,
    );
    // Les « ]] » déjà présents sont remplacés, pas doublés.
    expect(view.state.doc.toString()).toBe(`Voir ${formatNodeLink(CACHE)}`);
    view.destroy();
  });

  it('affiche le lien par le titre courant, ou le signale cassé', () => {
    const view = editor(
      `A ${formatNodeLink(CACHE)} B ${formatNodeLink(CACHE, 'le cache')} C ${formatNodeLink('99999999-0000-4000-8000-000000000000')}`,
    );
    const chips = [...view.dom.querySelectorAll('.cm-node-link')];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Cache Redis',
      'le cache',
      'lien cassé',
    ]);
    expect(chips[2]!.classList.contains('broken')).toBe(true);
    // Le texte enregistré garde l'identifiant.
    expect(view.state.doc.toString()).toContain(`node:${CACHE}`);
    view.destroy();
  });
});

describe('BacklinkList', () => {
  it('liste les mentions et ouvre le nœud ou le document', async () => {
    const call = vi.fn(async () => [
      {
        nodeId: 'n1',
        nodeTitle: 'API',
        documentId: 'd1',
        documentTitle: 'Notes',
        snippet: 'lit le [[Cache Redis]]',
      },
    ]);
    const onNavigate = vi.fn();
    const onOpenDocument = vi.fn();
    render(
      <ServicesProvider
        client={{ call } as unknown as NodalClient}
        tracker={new SaveTracker(() => undefined)}
        reportError={vi.fn()}
        reportInfo={vi.fn()}
      >
        <BacklinkList
          nodeId={CACHE}
          revision={0}
          onNavigate={onNavigate}
          onOpenDocument={onOpenDocument}
        />
      </ServicesProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'API' }));
    expect(onNavigate).toHaveBeenCalledWith('n1');
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(onOpenDocument).toHaveBeenCalledWith('d1', 'n1');
    expect(screen.getByText('lit le [[Cache Redis]]')).toBeTruthy();
    expect(call).toHaveBeenCalledWith('node:backlinks', { id: CACHE });
  });
});

describe('SuggestionList', () => {
  it('relie, convertit ou ignore, puis relit la liste', async () => {
    const suggestion = {
      targetId: 't1',
      targetTitle: 'Kafka',
      documentId: 'd1',
      documentTitle: 'Notes',
      snippet: 'publie dans kafka',
    };
    let listed = [suggestion];
    const call = vi.fn(async (channel: string) => {
      if (channel === 'suggestion:listForNode') return listed;
      listed = [];
      return null;
    });
    const onRelationsChanged = vi.fn();
    render(
      <ServicesProvider
        client={{ call } as unknown as NodalClient}
        tracker={new SaveTracker(() => undefined)}
        reportError={vi.fn()}
        reportInfo={vi.fn()}
      >
        <SuggestionList
          nodeId="n1"
          revision={0}
          onNavigate={vi.fn()}
          onRelationsChanged={onRelationsChanged}
        />
      </ServicesProvider>,
    );
    expect(
      await screen.findByRole('region', { name: 'Relier ?' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'En lien [[…]]' }));
    await vi.waitFor(() => expect(onRelationsChanged).toHaveBeenCalled());
    expect(call).toHaveBeenCalledWith('suggestion:accept', {
      sourceId: 'n1',
      targetId: 't1',
      mode: 'link',
    });
    // Plus de suggestion : la section disparaît.
    await vi.waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Relier ?' })).toBeNull(),
    );
  });
});
