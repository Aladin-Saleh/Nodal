import { useCallback, useEffect, useState } from 'react';
import {
  currentLessons,
  LESSON_OUTCOME_LABELS,
  type Lesson,
} from '../../../shared/lessons';
import { useClient, useReportError, useRunner } from '../../app/context';
import { Modal } from '../../components/Modal';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' });

/**
 * Mémoire de travail : leçons notées par un assistant, une par question et
 * par issue. Supprimer une leçon retire aussi ses répétitions.
 */
export function LessonsDialog({
  onNavigate,
  onClose,
}: {
  onNavigate(nodeId: string): void;
  onClose(): void;
}) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const [lessons, setLessons] = useState<Lesson[] | null>(null);

  const reload = useCallback(
    () => client.call('lesson:list').then(setLessons, reportError),
    [client, reportError],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = async (lesson: Lesson) => {
    const same = (lessons ?? []).filter(
      (other) => other.key === lesson.key && other.outcome === lesson.outcome,
    );
    await run(async () => {
      for (const { id } of same) await client.call('lesson:delete', { id });
      return true;
    });
    void reload();
  };

  const shown = currentLessons(lessons ?? []);
  return (
    <Modal
      title="Leçons de l’assistant"
      size="large"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <p className="muted">
        Ce qu’ont donné ses recherches : il évite de refaire une impasse et
        tient compte de vos corrections. Leur poids diminue avec le temps.
      </p>
      {lessons === null ? (
        <p className="muted">Chargement…</p>
      ) : shown.length === 0 ? (
        <p className="muted">Aucune leçon pour l’instant.</p>
      ) : (
        <ul className="assistant-changes">
          {shown.map((lesson) => (
            <li key={lesson.id}>
              <div className="assistant-change-text">
                <span>
                  <span className="badge">
                    {LESSON_OUTCOME_LABELS[lesson.outcome]}
                  </span>{' '}
                  {lesson.question}
                </span>
                {lesson.note && <span>{lesson.note}</span>}
                <span className="muted">
                  {dateFormat.format(new Date(lesson.createdAt))}
                  {lesson.client && ` · ${lesson.client}`}
                  {lesson.stale && ' · le code a changé depuis : à revérifier'}
                </span>
              </div>
              <div className="assistant-change-actions">
                {lesson.nodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="link-button"
                    onClick={() => onNavigate(node.id)}
                  >
                    {node.title}
                  </button>
                ))}
                <button
                  type="button"
                  className="secondary"
                  aria-label={`Supprimer la leçon « ${lesson.question} »`}
                  onClick={() => void remove(lesson)}
                >
                  Supprimer
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
