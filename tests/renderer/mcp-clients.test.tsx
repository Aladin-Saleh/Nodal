// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import { McpDialog } from '../../src/renderer/features/workspace/McpDialog';
import {
  MCP_CLIENTS,
  mcpSetup,
} from '../../src/renderer/features/workspace/mcp-clients';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';

afterEach(cleanup);

const files = ['C:\\Nodal\\nodal-mcp.cjs', 'C:\\Mes docs\\kb.nodal'] as const;

describe('mcpSetup', () => {
  it('Gemini CLI : gemini mcp add, options du serveur après --', () => {
    expect(mcpSetup('gemini-cli', files, false)).toMatchObject({
      kind: 'command',
      text: 'gemini mcp add nodal node "C:\\Nodal\\nodal-mcp.cjs" "C:\\Mes docs\\kb.nodal"',
      instructionsFile: 'GEMINI.md',
    });
    expect(mcpSetup('gemini-cli', files, true).text).toMatch(
      / -- --read-only$/,
    );
  });

  it('Claude Code et Codex : la commande du serveur suit --', () => {
    expect(mcpSetup('claude-code', files, true).text).toBe(
      'claude mcp add nodal -- node "C:\\Nodal\\nodal-mcp.cjs" "C:\\Mes docs\\kb.nodal" --read-only',
    );
    expect(mcpSetup('codex', files, false).text).toMatch(
      /^codex mcp add nodal -- node "/,
    );
  });

  it('fichiers JSON : mcpServers, ou servers pour VS Code', () => {
    expect(JSON.parse(mcpSetup('cursor', files, true).text)).toEqual({
      mcpServers: {
        nodal: { command: 'node', args: [...files, '--read-only'] },
      },
    });
    expect(JSON.parse(mcpSetup('vscode', files, false).text)).toEqual({
      servers: {
        nodal: { type: 'stdio', command: 'node', args: [...files] },
      },
    });
    expect(
      mcpSetup('claude-desktop', files, false).instructionsFile,
    ).toBeNull();
  });

  it('a une configuration pour chaque assistant proposé', () => {
    for (const client of MCP_CLIENTS) {
      expect(mcpSetup(client, files, false).text).toContain('nodal-mcp.cjs');
    }
  });
});

describe('McpDialog', () => {
  it('affiche la commande de l’assistant choisi', async () => {
    const call = vi.fn(async () => ({ mcpServerPath: files[0] }));
    render(
      <ServicesProvider
        client={{ call } as unknown as NodalClient}
        tracker={new SaveTracker(() => undefined)}
        reportError={vi.fn()}
        reportInfo={vi.fn()}
      >
        <McpDialog
          workspaceName="KB"
          workspaceFile={files[1]}
          onClose={vi.fn()}
        />
      </ServicesProvider>,
    );
    expect(await screen.findByText(/^claude mcp add nodal/)).toBeTruthy();
    expect(screen.getByText('CLAUDE.md')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Assistant'), {
      target: { value: 'gemini-cli' },
    });
    expect(screen.getByText(/^gemini mcp add nodal node/)).toBeTruthy();
    expect(screen.getByText('GEMINI.md')).toBeTruthy();
    expect(screen.queryByText(/^claude mcp add/)).toBeNull();
  });
});
