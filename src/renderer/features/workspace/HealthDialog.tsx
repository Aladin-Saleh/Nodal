import { useCallback, useEffect, useState } from 'react';
import type {
  HealthCheckId,
  HealthIssue,
  HealthReport,
  SearchGap,
} from '../../../shared/model';
import { useClient, useReportError, useRunner } from '../../app/context';
import { Modal } from '../../components/Modal';

export interface HealthDialogProps {
  /** `gaps` : ouverte sur les sujets à documenter. */
  focus: 'all' | 'gaps';
  onClose(): void;
  onOpenNode(id: string): void;
  onOpenDocument(documentId: string, nodeId: string): void;
  onValidate(ids: string[]): void;
  /** Créer un nœud pour un sujet à documenter (marqué traité ensuite). */
  onCreateFromGap(gap: SearchGap): void;
}

/** Explication de chaque vérification, affichée sous son titre. */
const HINTS: Partial<Record<HealthCheckId, string>> = {
  noSummary:
    'Une ou deux phrases suffisent ; la recherche et l’IA s’en servent.',
  emptyDocument: 'À remplir ou à supprimer.',
  orphan: 'Ni relation ni enfant : à relier, ou à ranger.',
  brokenLink: 'Le nœud visé a été supprimé ou renommé (lien par titre).',
  duplicate: 'Titres presque identiques : à fusionner ou à distinguer.',
  assistantPending: 'Ajouté par un assistant IA, pas encore vérifié.',
};

/**
 * Santé de la base : chaque vérification avec son nombre, puis ses lignes,
 * chacune avec l'action qui permet de corriger ; et les sujets à documenter
 * (recherches d'un assistant restées sans résultat).
 */
export function HealthDialog({
  focus,
  onClose,
  onOpenNode,
  onOpenDocument,
  onValidate,
  onCreateFromGap,
}: HealthDialogProps) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const [report, setReport] = useState<HealthReport | null>(null);

  const load = useCallback(
    () => client.call('health:report').then(setReport, reportError),
    [client, reportError],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const ignoreGap = async (gap: SearchGap) => {
    await run(() =>
      client.call('gap:setStatus', { key: gap.key, status: 'ignored' }),
    );
    void load();
  };

  const actions = (item: HealthIssue) => {
    const open = (
      <button
        type="button"
        className="secondary"
        onClick={() => onOpenNode(item.nodeId)}
      >
        Ouvrir
      </button>
    );
    switch (item.check) {
      case 'emptyDocument':
      case 'brokenLink':
        return (
          <button
            type="button"
            className="secondary"
            onClick={() => onOpenDocument(item.documentId!, item.nodeId)}
          >
            Ouvrir le document
          </button>
        );
      case 'duplicate':
        return (
          <>
            {open}
            <button
              type="button"
              className="secondary"
              onClick={() => onOpenNode(item.otherNodeId!)}
            >
              Ouvrir l’autre
            </button>
          </>
        );
      case 'assistantPending':
        return (
          <>
            {open}
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onValidate([item.nodeId]);
                setTimeout(() => void load(), 300);
              }}
            >
              Valider
            </button>
          </>
        );
      default:
        return open;
    }
  };

  const gaps = report && (
    <section className="health-check" aria-label="Sujets à documenter">
      <h3>
        Sujets à documenter <span className="badge">{report.gaps.length}</span>
      </h3>
      <p className="muted">
        Recherches d’un assistant IA restées sans résultat (requête, nombre de
        fois, date seulement).
      </p>
      {report.gaps.length === 0 ? (
        <p className="muted">Aucun pour l’instant.</p>
      ) : (
        <ul className="health-list">
          {report.gaps.map((gap) => (
            <li key={gap.key}>
              <span className="health-title">« {gap.query} »</span>
              <span className="muted">
                {gap.count > 1 ? `${gap.count} fois` : '1 fois'}, le{' '}
                {new Date(gap.lastAt).toLocaleDateString()}
              </span>
              <span className="health-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onCreateFromGap(gap)}
                >
                  Créer un nœud
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void ignoreGap(gap)}
                >
                  Ignorer
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <Modal
      title={focus === 'gaps' ? 'Sujets à documenter' : 'Santé de la base'}
      size="large"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="secondary"
            onClick={() => void load()}
          >
            Actualiser
          </button>
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </>
      }
    >
      {!report ? (
        <p className="muted">Analyse…</p>
      ) : (
        <div className="health-report">
          {focus === 'gaps' && gaps}
          {report.checks.map((check) => (
            <section
              key={check.id}
              className="health-check"
              aria-label={check.label}
            >
              <h3>
                {check.label}{' '}
                <span className={check.count > 0 ? 'badge warn' : 'badge'}>
                  {check.count}
                </span>
              </h3>
              {HINTS[check.id] && check.count > 0 && (
                <p className="muted">{HINTS[check.id]}</p>
              )}
              {check.issues.length > 0 && (
                <ul className="health-list">
                  {check.issues.map((item, index) => (
                    <li
                      key={`${item.nodeId}:${item.documentId ?? ''}:${index}`}
                    >
                      <span className="health-title">{item.title}</span>
                      {(item.documentTitle || item.detail) && (
                        <span className="muted">
                          {[item.documentTitle, item.detail]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                      <span className="health-actions">{actions(item)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {check.count > check.issues.length && (
                <p className="muted">
                  … et {check.count - check.issues.length} autres.
                </p>
              )}
            </section>
          ))}
          {focus === 'all' && gaps}
        </div>
      )}
    </Modal>
  );
}
