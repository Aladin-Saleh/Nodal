import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  /** Nom de la zone, affiché dans le message (ex. « le graphe »). */
  area: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Isole une erreur de rendu (§9 : erreurs de rendu isolées) : seule la zone
 * concernée affiche un message, le reste de l'application continue de
 * fonctionner et aucune donnée n'est touchée.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ui] erreur d'affichage dans ${this.props.area}`,
      error,
      info.componentStack,
    );
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p>
          Impossible d’afficher {this.props.area}. Les données de l’espace ne
          sont pas affectées.
        </p>
        <p className="muted">{this.state.error.message}</p>
        <button
          type="button"
          className="secondary"
          onClick={() => this.setState({ error: null })}
        >
          Réessayer
        </button>
      </div>
    );
  }
}
