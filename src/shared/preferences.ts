/**
 * Préférences de l'application, propres à l'utilisateur (profil) et non à un
 * espace : apparence de l'interface et quelques comportements.
 */
import { z } from 'zod';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Couleurs d'accent proposées (valeurs dans le CSS du renderer). */
export const ACCENTS = [
  'blue',
  'indigo',
  'violet',
  'teal',
  'green',
  'orange',
  'pink',
  'graphite',
] as const;
export type Accent = (typeof ACCENTS)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

/** Tailles du texte proposées, en pourcentage (zoom de la fenêtre). */
export const ZOOM_LEVELS = [80, 90, 100, 110, 125, 150] as const;
export type ZoomLevel = (typeof ZOOM_LEVELS)[number];

export const START_VIEWS = ['graph', 'documents'] as const;
export type StartView = (typeof START_VIEWS)[number];

export const preferencesSchema = z.strictObject({
  theme: z.enum(THEMES),
  accent: z.enum(ACCENTS),
  density: z.enum(DENSITIES),
  zoom: z.union(ZOOM_LEVELS.map((level) => z.literal(level))),
  startView: z.enum(START_VIEWS),
  reopenLastWorkspace: z.boolean(),
  showGraphHints: z.boolean(),
  /** Déplier / replier dans l'arbre fait de même dans le graphe, et inversement. */
  linkTreeAndGraphFolding: z.boolean(),
});

export type AppPreferences = z.infer<typeof preferencesSchema>;

export const preferencesUpdateSchema = preferencesSchema.partial();
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'system',
  accent: 'blue',
  density: 'comfortable',
  zoom: 100,
  startView: 'graph',
  reopenLastWorkspace: true,
  showGraphHints: true,
  linkTreeAndGraphFolding: false,
};

/** Niveau de zoom voisin (Ctrl+= / Ctrl+-), borné aux niveaux proposés. */
export function stepZoom(current: ZoomLevel, direction: 1 | -1): ZoomLevel {
  const index = ZOOM_LEVELS.indexOf(current);
  const next = Math.min(
    ZOOM_LEVELS.length - 1,
    Math.max(0, (index < 0 ? ZOOM_LEVELS.indexOf(100) : index) + direction),
  );
  return ZOOM_LEVELS[next]!;
}
