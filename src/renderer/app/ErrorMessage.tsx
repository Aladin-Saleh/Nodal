export interface ErrorMessageProps {
  message: string;
  onDismiss(): void;
}

export function ErrorMessage({ message, onDismiss }: ErrorMessageProps) {
  return (
    <div className="error" role="alert">
      <span>{message}</span>
      <button
        type="button"
        className="link-button"
        aria-label="Fermer le message d’erreur"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
