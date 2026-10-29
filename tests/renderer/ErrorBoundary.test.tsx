// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/renderer/components/ErrorBoundary';

afterEach(cleanup);

let shouldThrow = true;
function Fragile() {
  if (shouldThrow) throw new Error('WebGL perdu');
  return <p>Graphe affiché</p>;
}

describe('ErrorBoundary', () => {
  it('isole une erreur de rendu et permet de réessayer', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <ErrorBoundary area="le graphe">
          <Fragile />
        </ErrorBoundary>
        <p>Arborescence intacte</p>
      </div>,
    );
    expect(screen.getByRole('alert').textContent).toContain(
      'Impossible d’afficher le graphe',
    );
    expect(screen.getByText('WebGL perdu')).toBeTruthy();
    expect(screen.getByText('Arborescence intacte')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(screen.getByText('Graphe affiché')).toBeTruthy();
  });
});
