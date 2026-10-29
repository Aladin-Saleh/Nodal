import { useId, useState, type FormEvent } from 'react';
import { WORKSPACE_NAME_MAX_LENGTH } from '../../shared/domain';

export interface WelcomeScreenProps {
  busy: boolean;
  onCreate(name: string): void;
  onOpen(): void;
}

export function WelcomeScreen({ busy, onCreate, onOpen }: WelcomeScreenProps) {
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
          <button type="button" disabled={busy} onClick={onOpen}>
            Ouvrir…
          </button>
        </div>
      </div>
    </section>
  );
}
