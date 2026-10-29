import { useId, useState } from 'react';
import type {
  IntegrityReport,
  LlmExportOptions,
  NodeSummary,
} from '../../../shared/model';
import { Modal } from '../../components/Modal';

/** Options de l'export LLM (§6.7) : portée et taille des fragments. */
export function LlmExportDialog({
  selected,
  onSubmit,
  onCancel,
}: {
  /** Nœud sélectionné, point de départ d'un export partiel. */
  selected: NodeSummary | null;
  onSubmit(options: LlmExportOptions): void;
  onCancel(): void;
}) {
  const name = useId();
  const depthId = useId();
  const tokensId = useId();
  const [kind, setKind] = useState<'workspace' | 'subtree' | 'neighborhood'>(
    'workspace',
  );
  const [depth, setDepth] = useState(2);
  const [maxTokens, setMaxTokens] = useState(800);
  const tokensValid = maxTokens >= 64 && maxTokens <= 32_000;

  const submit = () => {
    if (!tokensValid) return;
    const scope =
      kind === 'workspace' || !selected
        ? ({ kind: 'workspace' } as const)
        : kind === 'subtree'
          ? ({ kind: 'subtree', nodeId: selected.id } as const)
          : ({ kind: 'neighborhood', nodeId: selected.id, depth } as const);
    onSubmit({ scope, maxTokens });
  };

  return (
    <Modal
      title="Exporter pour un LLM"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="secondary" onClick={onCancel}>
            Annuler
          </button>
          <button type="button" disabled={!tokensValid} onClick={submit}>
            Choisir le dossier…
          </button>
        </>
      }
    >
      <p className="muted">
        Produit un dossier contenant le graphe au format TOON (et JSON), les
        documents dans leur format source et des fragments découpés selon leur
        structure. Les documents d’origine ne sont pas modifiés.
      </p>
      <fieldset className="choices">
        <legend>Portée</legend>
        <label>
          <input
            type="radio"
            name={name}
            checked={kind === 'workspace'}
            onChange={() => setKind('workspace')}
          />
          Tout l’espace
        </label>
        <label>
          <input
            type="radio"
            name={name}
            disabled={!selected}
            checked={kind === 'subtree'}
            onChange={() => setKind('subtree')}
          />
          Sous-arbre de{' '}
          {selected ? `« ${selected.title} »` : 'nœud sélectionné'}
        </label>
        <label>
          <input
            type="radio"
            name={name}
            disabled={!selected}
            checked={kind === 'neighborhood'}
            onChange={() => setKind('neighborhood')}
          />
          Voisinage de {selected ? `« ${selected.title} »` : 'nœud sélectionné'}
        </label>
      </fieldset>
      {kind === 'neighborhood' && selected && (
        <>
          <label htmlFor={depthId}>Niveaux de voisinage</label>
          <select
            id={depthId}
            value={depth}
            onChange={(event) => setDepth(Number(event.target.value))}
          >
            {[1, 2, 3, 4, 5].map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor={tokensId}>Taille maximale d’un fragment (tokens)</label>
      <input
        id={tokensId}
        type="number"
        min={64}
        max={32000}
        value={maxTokens}
        onChange={(event) =>
          setMaxTokens(Number.parseInt(event.target.value, 10) || 0)
        }
      />
      <p className="muted">
        Tokens comptés avec le tokenizer o200k_base (js-tiktoken), indiqué dans
        le manifest de l’export.
      </p>
    </Modal>
  );
}

/** Rapport de vérification d'intégrité (§6.10). */
export function IntegrityReportDialog({
  report,
  onClose,
}: {
  report: IntegrityReport;
  onClose(): void;
}) {
  return (
    <Modal
      title="Vérification de l’intégrité"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <p>
        {report.ok
          ? 'Aucun problème détecté.'
          : 'Des problèmes ont été détectés. Faites une sauvegarde et un export avant toute autre modification.'}
      </p>
      <ul className="report-list">
        {report.checks.map((check) => (
          <li key={check.name}>
            <span className={check.ok ? 'check-ok' : 'check-ko'}>
              {check.ok ? '✓' : '✗'}
            </span>{' '}
            {check.name}
            {check.details.length > 0 && (
              <ul>
                {check.details.map((detail) => (
                  <li key={detail} className="muted">
                    {detail}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Rapport d'erreurs d'un import refusé (§6.10). */
export function ImportReportDialog({
  errors,
  onClose,
}: {
  errors: string[];
  onClose(): void;
}) {
  return (
    <Modal
      title="Import impossible"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <p>
        L’export n’a pas été importé : la validation a détecté les problèmes
        suivants. Aucun espace n’a été créé ni modifié.
      </p>
      <ul className="report-list">
        {errors.map((error) => (
          <li key={error} className="check-ko-text">
            {error}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
