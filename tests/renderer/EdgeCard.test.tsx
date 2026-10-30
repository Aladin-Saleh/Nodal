// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EdgeCard } from '../../src/renderer/features/graph/EdgeCard';
import type { EdgeInfo } from '../../src/shared/model';

afterEach(cleanup);

const edge: EdgeInfo = {
  id: 'e1',
  sourceId: 'api',
  targetId: 'db',
  relationTypeId: 'uses',
  label: null,
  description: 'Lecture seule,\nvia le pool de connexions.',
  createdAt: '',
  updatedAt: '',
};
const uses = {
  id: 'uses',
  name: 'utilise',
  color: '#ff0000',
  isBuiltin: true,
  usageCount: 1,
};

function renderCard(overrides: Partial<EdgeInfo> = {}) {
  const handlers = {
    onNavigate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <EdgeCard
      edge={{ ...edge, ...overrides }}
      relationType={uses}
      sourceTitle="API"
      targetTitle="Base"
      {...handlers}
    />,
  );
  return handlers;
}

describe('EdgeCard', () => {
  it('affiche les extrémités, le type et la description', () => {
    renderCard();
    const card = screen.getByRole('complementary', {
      name: 'Relation sélectionnée',
    });
    expect(card.textContent).toContain('API→ utilise →Base');
    expect(card.textContent).toContain(
      'Lecture seule,\nvia le pool de connexions.',
    );
  });

  it('préfère le libellé propre au nom du type et signale l’absence de description', () => {
    renderCard({ label: 'lit', description: null });
    expect(screen.getByText('→ lit →')).toBeTruthy();
    expect(screen.getByText(/Aucune description/)).toBeTruthy();
  });

  it('navigue vers une extrémité, modifie, supprime et se ferme', () => {
    const handlers = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Base' }));
    expect(handlers.onNavigate).toHaveBeenCalledWith('db');
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer…' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Fermer la fiche de la relation' }),
    );
    expect(handlers.onEdit).toHaveBeenCalledOnce();
    expect(handlers.onDelete).toHaveBeenCalledOnce();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });
});
