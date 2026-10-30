import { useId, type ReactNode } from 'react';
import {
  ACCENTS,
  DEFAULT_PREFERENCES,
  ZOOM_LEVELS,
  type Accent,
  type AppPreferences,
  type Density,
  type StartView,
  type Theme,
} from '../../../shared/preferences';
import { usePreferences } from '../../app/preferences';
import { Modal } from '../../components/Modal';

const THEME_LABELS: Record<Theme, string> = {
  system: 'Système',
  light: 'Clair',
  dark: 'Sombre',
};

const ACCENT_LABELS: Record<Accent, string> = {
  blue: 'Bleu',
  indigo: 'Indigo',
  violet: 'Violet',
  teal: 'Sarcelle',
  green: 'Vert',
  orange: 'Orange',
  pink: 'Rose',
  graphite: 'Graphite',
};

const DENSITY_LABELS: Record<Density, string> = {
  comfortable: 'Confortable',
  compact: 'Compacte',
};

const VIEW_LABELS: Record<StartView, string> = {
  graph: 'Graphe',
  documents: 'Documents',
};

/** Choix exclusif présenté comme un groupe de boutons. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange(value: T): void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {(Object.keys(options) as T[]).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {options[option]}
        </button>
      ))}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="pref-row">
      <div className="pref-label">
        <span>{label}</span>
        {hint && <span className="muted">{hint}</span>}
      </div>
      <div className="pref-control">{children}</div>
    </div>
  );
}

/**
 * Préférences de l'application (profil utilisateur) : apparence et
 * comportement. Chaque changement s'applique et s'enregistre aussitôt.
 */
export function PreferencesDialog({ onClose }: { onClose(): void }) {
  const { preferences, update } = usePreferences();
  const zoomId = useId();
  const set = <K extends keyof AppPreferences>(
    key: K,
    value: AppPreferences[K],
  ) => void update({ [key]: value });

  return (
    <Modal
      title="Préférences"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="secondary left"
            onClick={() => void update(DEFAULT_PREFERENCES)}
          >
            Rétablir les valeurs par défaut
          </button>
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </>
      }
    >
      <section className="pref-section" aria-labelledby="pref-appearance">
        <h3 id="pref-appearance">Apparence</h3>
        <Row label="Thème" hint="« Système » suit le réglage de Windows.">
          <Segmented
            label="Thème"
            value={preferences.theme}
            options={THEME_LABELS}
            onChange={(theme) => set('theme', theme)}
          />
        </Row>
        <Row label="Couleur d’accent">
          <div
            className="accent-swatches"
            role="radiogroup"
            aria-label="Couleur d’accent"
          >
            {ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                role="radio"
                aria-checked={preferences.accent === accent}
                aria-label={ACCENT_LABELS[accent]}
                title={ACCENT_LABELS[accent]}
                className={`accent-swatch accent-${accent}`}
                onClick={() => set('accent', accent)}
              />
            ))}
          </div>
        </Row>
        <Row label="Densité" hint="Compacte : plus d’éléments à l’écran.">
          <Segmented
            label="Densité"
            value={preferences.density}
            options={DENSITY_LABELS}
            onChange={(density) => set('density', density)}
          />
        </Row>
        <Row
          label="Taille du texte"
          hint="Aussi avec Ctrl + / Ctrl − / Ctrl 0."
        >
          <select
            id={zoomId}
            aria-label="Taille du texte"
            value={preferences.zoom}
            onChange={(event) =>
              set('zoom', Number(event.target.value) as AppPreferences['zoom'])
            }
          >
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level} %
              </option>
            ))}
          </select>
        </Row>
      </section>

      <section className="pref-section" aria-labelledby="pref-behavior">
        <h3 id="pref-behavior">Comportement</h3>
        <Row label="Vue à l’ouverture d’un espace">
          <Segmented
            label="Vue à l’ouverture d’un espace"
            value={preferences.startView}
            options={VIEW_LABELS}
            onChange={(view) => set('startView', view)}
          />
        </Row>
        <Row label="Au démarrage">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={preferences.reopenLastWorkspace}
              onChange={(event) =>
                set('reopenLastWorkspace', event.target.checked)
              }
            />
            Rouvrir le dernier espace
          </label>
        </Row>
        <Row label="Graphe">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={preferences.showGraphHints}
              onChange={(event) => set('showGraphHints', event.target.checked)}
            />
            Afficher l’aide des gestes
          </label>
        </Row>
      </section>
    </Modal>
  );
}
