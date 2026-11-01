// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureApp } from '../../src/renderer/features/capture/CaptureApp';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { DEFAULT_PREFERENCES } from '../../src/shared/preferences';
import type { CaptureTarget } from '../../src/shared/quick-capture';

afterEach(cleanup);

function clientWith(target: CaptureTarget | null) {
  const call = vi.fn(async (channel: string) => {
    if (channel === 'capture:getTarget') return target;
    if (channel === 'preferences:get') return DEFAULT_PREFERENCES;
    if (channel === 'capture:submit')
      return { workspaceName: 'KB', nodeId: 'n1' };
    throw new Error(channel);
  });
  const client = {
    call,
    onFlushRequest: () => () => undefined,
    onExternalChange: () => () => undefined,
    onPreferencesChanged: () => () => undefined,
  } as unknown as NodalClient;
  return { client, call };
}

describe('CaptureApp', () => {
  it('enregistre le titre et la note avec Ctrl+Entrée puis ferme', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, call } = clientWith({ workspaceName: 'KB', open: true });
    const close = vi.fn();
    render(<CaptureApp client={client} close={close} />);

    expect(
      await screen.findByText('Rangé dans « KB » › Boîte de réception'),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Titre'), {
      target: { value: ' Idée ' },
    });
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'détail' },
    });
    fireEvent.keyDown(screen.getByLabelText('Note'), {
      key: 'Enter',
      ctrlKey: true,
    });

    await screen.findByText('Enregistré dans « KB ».');
    expect(call).toHaveBeenCalledWith('capture:submit', {
      title: 'Idée',
      note: 'détail',
    });
    vi.advanceTimersByTime(1000);
    expect(close).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('ne permet pas d’enregistrer sans titre ; Échap ferme', async () => {
    const { client } = clientWith({ workspaceName: 'KB', open: false });
    const close = vi.fn();
    render(<CaptureApp client={client} close={close} />);
    await screen.findByText(/espace fermé/);
    expect(
      (screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('Titre'), { key: 'Escape' });
    expect(close).toHaveBeenCalled();
  });

  it('prévient quand aucun espace ne peut recevoir la capture', async () => {
    const { client } = clientWith(null);
    render(<CaptureApp client={client} close={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Aucun espace récent',
      ),
    );
  });
});
