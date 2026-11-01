// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '../../src/renderer/app/context';
import { NewDocumentDialog } from '../../src/renderer/features/documents/DocumentsPanel';
import { NewNodeDialog } from '../../src/renderer/features/nodes/NodeDialogs';
import { TemplatesDialog } from '../../src/renderer/features/templates/TemplatesDialog';
import type { NodalClient } from '../../src/renderer/services/nodal-client';
import { SaveTracker } from '../../src/renderer/services/save-tracker';
import { DEFAULT_TEMPLATES } from '../../src/shared/templates';

afterEach(cleanup);

function withServices(children: ReactNode) {
  const call = vi.fn(async (channel: string, ...args: unknown[]) => {
    if (channel === 'template:list')
      return { templates: DEFAULT_TEMPLATES, customized: false };
    if (channel === 'template:save') {
      const [{ templates }] = args as [{ templates: unknown }];
      return { templates, customized: true };
    }
    return null;
  });
  render(
    <ServicesProvider
      client={{ call } as unknown as NodalClient}
      tracker={new SaveTracker(() => undefined)}
      reportError={vi.fn()}
      reportInfo={vi.fn()}
    >
      {children}
    </ServicesProvider>,
  );
  return call;
}

const select = (label: string) =>
  screen.getByLabelText(label) as HTMLSelectElement;

describe('NewNodeDialog', () => {
  it('propose le modèle du type choisi, ou aucun', async () => {
    const onSubmit = vi.fn();
    withServices(
      <NewNodeDialog
        parentTitle={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByRole('option', { name: 'Procédure' });
    expect(select('Modèle de document').value).toBe('');

    fireEvent.change(select('Type'), { target: { value: 'procedure' } });
    expect(select('Modèle de document').value).toBe('procedure');
    fireEvent.change(screen.getByLabelText('Titre'), {
      target: { value: 'Déployer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    expect(onSubmit).toHaveBeenCalledWith(
      'Déployer',
      'procedure',
      null,
      'procedure',
    );

    fireEvent.change(select('Type'), { target: { value: 'resource' } });
    expect(select('Modèle de document').value).toBe('');
  });
});

describe('NewDocumentDialog', () => {
  it('reprend le titre du modèle et impose le Markdown', async () => {
    const onSubmit = vi.fn();
    withServices(
      <NewDocumentDialog
        nodeType="data"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await screen.findByRole('option', { name: 'Donnée' });
    fireEvent.change(select('Modèle'), { target: { value: 'data' } });
    expect((screen.getByLabelText('Titre') as HTMLInputElement).value).toBe(
      'Fiche donnée',
    );
    expect(select('Type de contenu').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Fiche donnée',
      contentType: 'markdown',
      language: null,
      templateId: 'data',
    });
  });
});

describe('TemplatesDialog', () => {
  it('modifie un modèle, en ajoute un et enregistre la liste', async () => {
    const onClose = vi.fn();
    const call = withServices(<TemplatesDialog onClose={onClose} />);
    await screen.findByRole('listbox', { name: 'Modèles' });
    fireEvent.change(screen.getByLabelText('Nom'), {
      target: { value: 'Mode opératoire' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau modèle' }));
    expect((screen.getByLabelText('Nom') as HTMLInputElement).value).toBe(
      'Nouveau modèle',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [, { templates }] = call.mock.calls.find(
      ([channel]) => channel === 'template:save',
    )! as unknown as [string, { templates: { id: string; name: string }[] }];
    expect(templates.map((t) => t.name)).toEqual([
      'Mode opératoire',
      'Composant',
      'Donnée',
      'Décision (ADR)',
      'Nouveau modèle',
    ]);
    expect(templates.at(-1)!.id).toBe('nouveau-modele');
  });
});
