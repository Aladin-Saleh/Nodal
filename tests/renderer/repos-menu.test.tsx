// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import type { AppAction } from '../../src/renderer/features/commands/actions';
import { ReposMenu } from '../../src/renderer/features/workspace/ReposMenu';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import type { CodeRootInfo } from '../../src/shared/code-anchors';

afterEach(cleanup);

function setup(roots: CodeRootInfo[]) {
  const call = vi.fn(async () => roots);
  const onOpenTerminalIn = vi.fn();
  const settings = vi.fn();
  const actions = [
    {
      id: 'workspace.settings',
      label: 'Paramètres de l’espace…',
      group: 'Espace',
      enabled: true,
      run: settings,
    },
  ] as AppAction[];
  render(
    <ServicesProvider
      client={{ call } as unknown as NodalClient}
      tracker={new SaveTracker(() => undefined)}
      reportError={vi.fn()}
      reportInfo={vi.fn()}
    >
      <ReposMenu actions={actions} onOpenTerminalIn={onOpenTerminalIn} />
    </ServicesProvider>,
  );
  return { call, onOpenTerminalIn, settings };
}

describe('ReposMenu', () => {
  it('liste les repos de l’espace et ouvre un terminal dans celui choisi', async () => {
    const { call, onOpenTerminalIn, settings } = setup([
      { path: 'C:/dev/api', exists: true },
      { path: 'C:/dev/ancien', exists: false },
    ]);
    const button = await screen.findByRole('button', { name: /Repos \(2\)/ });
    fireEvent.click(button);
    expect(call).toHaveBeenCalledTimes(2); // au montage, puis à l'ouverture
    const missing = screen.getByRole('menuitem', { name: 'ancien' });
    expect((missing as HTMLButtonElement).disabled).toBe(true);
    expect(missing.getAttribute('title')).toContain('introuvable');
    fireEvent.click(screen.getByRole('menuitem', { name: 'api' }));
    expect(onOpenTerminalIn).toHaveBeenCalledWith('C:/dev/api');

    fireEvent.click(button);
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Gérer les dossiers de code…' }),
    );
    expect(settings).toHaveBeenCalled();
  });

  it('indique un espace sans repo', async () => {
    setup([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Repos' }));
    expect(
      screen.getByRole('menuitem', { name: 'Aucun repo dans cet espace' }),
    ).toBeTruthy();
  });
});
