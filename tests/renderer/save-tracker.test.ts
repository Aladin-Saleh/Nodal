import { describe, expect, it, vi } from 'vitest';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import { NodalError } from '../../src/shared/errors';

describe('SaveTracker', () => {
  it('signale les modifications en attente puis leur enregistrement', async () => {
    const report = vi.fn();
    const tracker = new SaveTracker(report);
    const save = vi.fn(async () => {
      await tracker.track(Promise.resolve());
      tracker.setPending('doc', null);
    });

    tracker.setPending('doc', save);
    expect(tracker.getState().status).toBe('pending');
    expect(report).toHaveBeenLastCalledWith(true);

    await expect(tracker.flushAll()).resolves.toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(tracker.getState()).toEqual({ status: 'saved', error: null });
    expect(report).toHaveBeenLastCalledWith(false);
  });

  it('conserve l’erreur et la modification en attente en cas d’échec', async () => {
    const report = vi.fn();
    const tracker = new SaveTracker(report);
    tracker.setPending('doc', () =>
      tracker.track(
        Promise.reject(new NodalError('IO_ERROR', 'Disque plein.')),
      ),
    );

    await expect(tracker.flushAll()).resolves.toBe(false);
    expect(tracker.getState()).toEqual({
      status: 'error',
      error: 'Disque plein.',
    });
    expect(tracker.hasUnsavedChanges()).toBe(true);
    expect(report).toHaveBeenLastCalledWith(true);
  });

  it('notifie les abonnés uniquement quand l’état change', async () => {
    const tracker = new SaveTracker(() => undefined);
    const listener = vi.fn();
    tracker.subscribe(listener);
    await tracker.track(Promise.resolve(1));
    expect(listener.mock.calls.map(([state]) => state.status)).toEqual([
      'saving',
      'saved',
    ]);
  });
});
