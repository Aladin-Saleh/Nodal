import { useId, useState, type FormEvent } from 'react';
import { WORKSPACE_NAME_MAX_LENGTH } from '../../../shared/domain';
import type { RecentWorkspace } from '../../../shared/model';

export interface WelcomeScreenProps {
  busy: boolean;
  recent: RecentWorkspace[];
  onCreate(name: string): void;
  onOpen(): void;
  onImport(): void;
  onOpenRecent(id: string): void;
  onRemoveRecent(id: string): void;
}

export function WelcomeScreen({
  busy,
  recent,
  onCreate,
  onOpen,
  onImport,
  onOpenRecent,
  onRemoveRecent,
}: WelcomeScreenProps) {
  const nameId = useId();
  const [name, setName] = useState('');
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed.length > 0) onCreate(trimmed);
  };

  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <h1 id="welcome-title">Nodal</h1>
      <p className="muted">
        Base de connaissances techniques sous forme de graphe.
      </p>

      <div className="welcome-actions">
        <form className="card" onSubmit={submit}>
          <h2>Créer un espace</h2>
          <label htmlFor={nameId}>Nom de l’espace</label>
          <input
            id={nameId}
            type="text"
            value={name}
            maxLength={WORKSPACE_NAME_MAX_LENGTH}
            placeholder="Ma base de connaissances"
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={busy || trimmed.length === 0}>
            Créer…
          </button>
        </form>

        <div className="card">
          <h2>Ouvrir un espace</h2>
          <p className="muted">Ouvrir un fichier .nodal existant.</p>
          <div className="inline-form">
            <button type="button" disabled={busy} onClick={onOpen}>
              Ouvrir…
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              title="Créer un nouvel espace à partir d’un dossier d’export Nodal"
              onClick={onImport}
            >
              Importer un export…
            </button>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="recent">
          <h2>Espaces récents</h2>
          <ul>
            {recent.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="recent-open"
                  disabled={busy || !entry.exists}
                  onClick={() => onOpenRecent(entry.id)}
                >
                  <span className="recent-name">{entry.name}</span>
                  <span className="path muted">{entry.filePath}</span>
                  {!entry.exists && (
                    <span className="warning">Fichier introuvable</span>
                  )}
                </button>
                <button
                  type="button"
                  className="link-button"
                  aria-label={`Retirer ${entry.name} de la liste des récents`}
                  title="Retirer de la liste"
                  onClick={() => onRemoveRecent(entry.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
