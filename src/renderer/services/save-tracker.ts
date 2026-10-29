/**
 * Suivi des enregistrements (§6.1, §6.10) : modifications en attente,
 * écritures en cours et dernière erreur. Alimente l'indicateur de la barre
 * d'état et signale au main s'il reste des modifications non persistées.
 */
import { describeError } from './nodal-client';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface SaveState {
  status: SaveStatus;
  error: string | null;
}

type Flush = () => Promise<void>;

export class SaveTracker {
  private readonly pending = new Map<string, Flush>();
  private inFlight = 0;
  private lastError: string | null = null;
  private state: SaveState = { status: 'saved', error: null };
  private readonly listeners = new Set<(state: SaveState) => void>();
  private reportedUnsaved = false;

  /** @param reportUnsaved appelé quand l'existence de modifications non persistées change. */
  constructor(private readonly reportUnsaved: (unsaved: boolean) => void) {}

  getState(): SaveState {
    return this.state;
  }

  subscribe(listener: (state: SaveState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Déclare (ou retire avec `null`) une modification en attente d'écriture. */
  setPending(key: string, flush: Flush | null): void {
    if (flush) this.pending.set(key, flush);
    else this.pending.delete(key);
    this.update();
  }

  /** Suit une écriture : statut « enregistrement… », puis succès ou erreur. */
  async track<T>(operation: Promise<T>): Promise<T> {
    this.inFlight++;
    this.update();
    try {
      const result = await operation;
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = describeError(error);
      throw error;
    } finally {
      this.inFlight--;
      this.update();
    }
  }

  /** Écrit immédiatement tout ce qui est en attente ; `true` si tout a réussi. */
  async flushAll(): Promise<boolean> {
    const flushes = [...this.pending.values()];
    const results = await Promise.allSettled(flushes.map((flush) => flush()));
    return (
      results.every((result) => result.status === 'fulfilled') &&
      this.pending.size === 0
    );
  }

  hasUnsavedChanges(): boolean {
    return this.pending.size > 0 || this.inFlight > 0;
  }

  private update(): void {
    const status: SaveStatus =
      this.inFlight > 0
        ? 'saving'
        : this.lastError
          ? 'error'
          : this.pending.size > 0
            ? 'pending'
            : 'saved';
    const next: SaveState = {
      status,
      error: status === 'error' ? this.lastError : null,
    };
    if (next.status !== this.state.status || next.error !== this.state.error) {
      this.state = next;
      for (const listener of this.listeners) listener(next);
    }
    const unsaved = this.hasUnsavedChanges();
    if (unsaved !== this.reportedUnsaved) {
      this.reportedUnsaved = unsaved;
      this.reportUnsaved(unsaved);
    }
  }
}
