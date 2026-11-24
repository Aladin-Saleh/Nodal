import type {
  DocumentChange,
  WorkspaceComparison,
} from '../../../shared/model';
import { Modal } from '../../components/Modal';

const CHANGE_LABELS: Record<DocumentChange['change'], string> = {
  added: 'ajouté',
  removed: 'supprimé',
  modified: 'modifié',
  moved: 'déplacé',
};

interface Row {
  nodeId: string | null;
  title: string;
  detail: string;
}

const signed = (chars: number) =>
  chars === 0 ? '' : ` (${chars > 0 ? '+' : '−'}${Math.abs(chars)} car.)`;

/** Ce qui a changé depuis une sauvegarde de l'espace. */
export function ComparisonDialog({
  file,
  comparison,
  onNavigate,
  onClose,
}: {
  file: string;
  comparison: WorkspaceComparison;
  onNavigate(nodeId: string): void;
  onClose(): void;
}) {
  const sections: { title: string; count: number; rows: Row[] }[] = [
    {
      title: 'Nœuds ajoutés',
      count: comparison.added.count,
      rows: comparison.added.items,
    },
    {
      title: 'Nœuds supprimés',
      count: comparison.removed.count,
      rows: comparison.removed.items,
    },
    {
      title: 'Nœuds modifiés',
      count: comparison.modified.count,
      rows: comparison.modified.items.map((item) => ({
        ...item,
        detail: item.changes.join(' ; '),
      })),
    },
    {
      title: 'Documents',
      count: comparison.documents.count,
      rows: comparison.documents.items.map((item) => ({
        nodeId: item.nodeId,
        title: `${item.nodeTitle} › ${item.title}`,
        detail: `${CHANGE_LABELS[item.change]}${signed(item.chars)}`,
      })),
    },
    {
      title: 'Relations ajoutées',
      count: comparison.relationsAdded.count,
      rows: comparison.relationsAdded.items,
    },
    {
      title: 'Relations supprimées',
      count: comparison.relationsRemoved.count,
      rows: comparison.relationsRemoved.items,
    },
  ].filter((section) => section.count > 0);
  return (
    <Modal
      title="Changements depuis la sauvegarde"
      size="large"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <p className="muted">{file}</p>
      {sections.length === 0 ? (
        <p role="status">Aucun changement.</p>
      ) : (
        <div className="health-report">
          {sections.map((section) => (
            <section
              key={section.title}
              className="health-check"
              aria-label={section.title}
            >
              <h3>
                {section.title} <span className="badge">{section.count}</span>
              </h3>
              <ul className="health-list">
                {section.rows.map((row, index) => (
                  <li key={`${row.nodeId}:${row.title}:${index}`}>
                    <span className="health-title">{row.title}</span>
                    <span className="muted">{row.detail}</span>
                    {row.nodeId && (
                      <span className="health-actions">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => onNavigate(row.nodeId!)}
                        >
                          Ouvrir
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {section.count > section.rows.length && (
                <p className="muted">
                  … et {section.count - section.rows.length} autres.
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
