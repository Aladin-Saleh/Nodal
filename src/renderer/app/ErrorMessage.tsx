export interface ErrorMessageProps {
  message: string;
  /** `info` pour un message de réussite, `error` par défaut. */
  kind?: 'error' | 'info';
  onDismiss(): void;
}

export function ErrorMessage({
  message,
  kind = 'error',
  onDismiss,
}: ErrorMessageProps) {
  return (
    <div
      className={kind === 'info' ? 'notice-info' : 'error'}
      role={kind === 'info' ? 'status' : 'alert'}
    >
      <span>{message}</span>
      <button
        type="button"
        className="link-button"
        aria-label="Fermer le message"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
