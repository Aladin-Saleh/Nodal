/**
 * Préférences de l'application côté renderer : chargées depuis le main,
 * appliquées au document (accent, densité) et exposées aux composants. Le
 * thème clair/sombre et la taille du texte sont appliqués par le main
 * (nativeTheme, zoom de la fenêtre) : le CSS suit \`prefers-color-scheme\`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_PREFERENCES,
  type AppPreferences,
  type PreferencesUpdate,
} from '../../shared/preferences';
import type { NodalClient } from '../services/nodal-client';

/** Événement émis quand l'apparence change (le graphe relit ses couleurs). */
export const APPEARANCE_EVENT = 'nodal:appearance';

interface PreferencesValue {
  preferences: AppPreferences;
  /** \`false\` tant que les préférences n'ont pas été lues. */
  loaded: boolean;
  update(changes: PreferencesUpdate): Promise<void>;
}

const PreferencesContext = createContext<PreferencesValue>({
  preferences: DEFAULT_PREFERENCES,
  loaded: false,
  update: async () => undefined,
});

function applyToDocument(preferences: AppPreferences): void {
  const root = document.documentElement;
  root.dataset.accent = preferences.accent;
  root.dataset.density = preferences.density;
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

export function PreferencesProvider({
  client,
  onError,
  children,
}: {
  client: NodalClient;
  onError(error: unknown): void;
  children: ReactNode;
}) {
  const [preferences, setPreferences] =
    useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    client.call('preferences:get').then(
      (stored) => {
        if (!active) return;
        setPreferences(stored);
        setLoaded(true);
      },
      (error: unknown) => {
        if (!active) return;
        setLoaded(true);
        onError(error);
      },
    );
    // Changement venu du main (raccourci de zoom).
    const off = client.onPreferencesChanged(setPreferences);
    return () => {
      active = false;
      off();
    };
  }, [client, onError]);

  useEffect(() => applyToDocument(preferences), [preferences]);

  const update = useCallback(
    async (changes: PreferencesUpdate) => {
      // Affichage immédiat, puis valeur confirmée par le main.
      setPreferences((current) => ({ ...current, ...changes }));
      try {
        setPreferences(await client.call('preferences:update', changes));
      } catch (error) {
        onError(error);
        setPreferences(await client.call('preferences:get'));
      }
    },
    [client, onError],
  );

  return (
    <PreferencesContext.Provider value={{ preferences, loaded, update }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export const usePreferences = () => useContext(PreferencesContext);
