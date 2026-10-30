// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssistantBadge } from '../../src/renderer/features/workspace/AssistantBadge';
import { assistantInstructions } from '../../src/renderer/features/workspace/McpDialog';

afterEach(cleanup);

describe('consignes « Nodal d’abord »', () => {
  it('nomment l’espace et les outils de lecture', () => {
    const text = assistantInstructions('Base infra', false);
    expect(text).toContain('« Base infra »');
    expect(text).toContain('`nodal_search`');
    expect(text).toContain('serveur MCP `nodal`');
    expect(text).not.toContain('nodal_link');
  });

  it('invitent à enregistrer ce qui est appris seulement si l’écriture est autorisée', () => {
    expect(assistantInstructions('Base infra', true)).toContain('`nodal_link`');
  });
});

describe('AssistantBadge', () => {
  it('ne s’affiche pas pour un élément saisi par l’utilisateur', () => {
    const { container } = render(
      <AssistantBadge origin={null} what="Relation créée" />,
    );
    expect(container.textContent).toBe('');
  });

  it('indique l’assistant et la date', () => {
    render(
      <AssistantBadge
        origin={{
          client: 'claude-code',
          createdAt: '2026-10-30T09:15:00.000Z',
        }}
        what="Relation créée"
      />,
    );
    const badge = screen.getByText('IA');
    expect(badge.title).toMatch(
      /^Relation créée par l’assistant IA \(claude-code\) le 30\/10\/2026/,
    );
  });
});
