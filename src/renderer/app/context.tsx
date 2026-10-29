import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { NodalClient } from '../services/nodal-client';
import type { SaveState, SaveTracker } from '../services/save-tracker';

interface AppServices {
  client: NodalClient;
  tracker: SaveTracker;
  /** Affiche une erreur lisible dans le bandeau de l'application. */
  reportError(error: unknown): void;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({
  client,
  tracker,
  reportError,
  children,
}: AppServices & { children: ReactNode }) {
  return (
    <ServicesContext.Provider value={{ client, tracker, reportError }}>
      {children}
    </ServicesContext.Provider>
  );
}

function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider manquant');
  return services;
}

export const useClient = () => useServices().client;
export const useSaveTracker = () => useServices().tracker;
export const useReportError = () => useServices().reportError;

/**
 * Exécute une écriture suivie par l'indicateur d'enregistrement ; une erreur
 * est affichée dans le bandeau et le résultat vaut alors `undefined`.
 */
export function useRunner() {
  const { tracker, reportError } = useServices();
  return useCallback(
    async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await tracker.track(operation());
      } catch (error) {
        reportError(error);
        return undefined;
      }
    },
    [tracker, reportError],
  );
}

export function useSaveState(): SaveState {
  const tracker = useSaveTracker();
  return useSyncExternalStore(
    (listener) => tracker.subscribe(listener),
    () => tracker.getState(),
  );
}

export interface AutosaveOptions<T> {
  /** Identifiant unique de la valeur suivie (ex. `document:<id>:body`). */
  key: string;
  value: T;
  save(value: T): Promise<unknown>;
  delayMs?: number;
}

/**
 * Enregistrement automatique avec délai (§6.3). La valeur initiale est
 * considérée comme enregistrée ; le composant doit être remonté (prop `key`)
 * quand il change d'objet édité. Toute valeur en attente est écrite au
 * démontage et lors d'un `flushAll`.
 */
export function useAutosave<T>({
  key,
  value,
  save,
  delayMs = 800,
}: AutosaveOptions<T>): void {
  const tracker = useSaveTracker();
  const saved = useRef(value);
  const latest = useRef(value);
  const saveRef = useRef(save);
  useLayoutEffect(() => {
    latest.current = value;
    saveRef.current = save;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = latest.current;
    if (Object.is(next, saved.current)) {
      tracker.setPending(key, null);
      return;
    }
    await tracker.track(saveRef.current(next));
    saved.current = next;
    if (Object.is(latest.current, next)) tracker.setPending(key, null);
  }, [key, tracker]);

  useEffect(() => {
    if (Object.is(value, saved.current)) return;
    tracker.setPending(key, flush);
    timer.current = setTimeout(() => {
      flush().catch(() => undefined);
    }, delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, key, flush, delayMs, tracker]);

  useEffect(
    () => () => {
      flush().catch(() => undefined);
    },
    [flush],
  );
}
