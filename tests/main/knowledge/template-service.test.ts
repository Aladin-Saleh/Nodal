import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createImplementations } from '../../../src/main/ipc/register';
import type { FileDialogs } from '../../../src/main/file-dialogs';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { exportWorkspace } from '../../../src/main/knowledge/export-service';
import { validateExportFolder } from '../../../src/main/knowledge/import-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import {
  addDocumentFromTemplate,
  readTemplates,
  requireTemplate,
  resetTemplates,
  saveTemplates,
} from '../../../src/main/knowledge/template-service';
import type { RecentWorkspacesStore } from '../../../src/main/workspace/recent-workspaces';
import { WorkspaceService } from '../../../src/main/workspace/workspace-service';
import { DEFAULT_PREFERENCES } from '../../../src/shared/preferences';
import {
  DEFAULT_TEMPLATES,
  type DocumentTemplate,
} from '../../../src/shared/templates';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

const custom: DocumentTemplate = {
  id: 'runbook',
  name: 'Runbook',
  nodeType: 'procedure',
  documentTitle: 'Runbook',
  body: '## Alerte\n\n## Diagnostic\n',
};

describe('modèles de documents', () => {
  it('suit les modèles par défaut tant que l’espace ne les a pas modifiés', () => {
    const { context } = workspace();
    const list = readTemplates(context());
    expect(list.customized).toBe(false);
    expect(list.templates).toEqual(DEFAULT_TEMPLATES);
    expect(list.templates.map((t) => t.nodeType)).toEqual([
      'procedure',
      'component',
      'data',
      'concept',
    ]);
  });

  it('enregistre la liste de l’espace, puis revient aux défauts', () => {
    const { context } = workspace();
    const saved = saveTemplates(context(), [custom]);
    expect(saved).toEqual({ templates: [custom], customized: true });
    expect(readTemplates(context()).templates).toEqual([custom]);

    expect(resetTemplates(context()).customized).toBe(false);
    expect(readTemplates(context()).templates).toEqual(DEFAULT_TEMPLATES);
  });

  it('refuse une liste invalide et ignore une valeur stockée illisible', () => {
    const { context } = workspace();
    expect(() =>
      saveTemplates(context(), [custom, { ...custom, id: 'autre' }]),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    context()
      .db.prepare(
        "INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, 'templates', '{oups')",
      )
      .run(context().workspaceId);
    expect(readTemplates(context()).customized).toBe(false);
  });

  it('trouve un modèle par nom sans casse, et liste les modèles sinon', () => {
    const { context } = workspace();
    expect(requireTemplate(context(), 'décision (adr)').id).toBe('adr');
    expect(() => requireTemplate(context(), 'Inconnu')).toThrowError(
      /« Procédure »/,
    );
  });

  it('ajoute un document Markdown rempli avec le modèle', () => {
    const { context } = workspace();
    const node = new NodeService(context).create({
      parentId: null,
      title: 'Déployer',
      nodeType: 'procedure',
    });
    const document = addDocumentFromTemplate(
      context(),
      node.id,
      requireTemplate(context(), 'procedure'),
    );
    expect(document).toMatchObject({
      title: 'Procédure',
      contentType: 'markdown',
    });
    expect(document.body).toContain('## Retour arrière');
  });
});

function implementations(service: WorkspaceService) {
  return createImplementations({
    workspaces: service,
    recent: {} as RecentWorkspacesStore,
    dialogs: {} as FileDialogs,
    trash: vi.fn(),
    getAppInfo: () => {
      throw new Error('non utilisé');
    },
    setUnsavedChanges: vi.fn(),
    getPreferences: () => DEFAULT_PREFERENCES,
    updatePreferences: vi.fn(),
    isTrustedSender: () => true,
    quickCapture: {
      target: vi.fn(),
      submit: vi.fn(),
      open: vi.fn(),
      shortcutRegistered: vi.fn(),
    },
  });
}

describe('création depuis un modèle (IPC)', () => {
  it('crée le nœud et le document du modèle ensemble', async () => {
    const { service, context } = workspace();
    const impl = implementations(service);
    const node = await impl['node:create']({
      parentId: null,
      title: 'Cache',
      nodeType: 'component',
      templateId: 'component',
    });
    const [document] = new NodeService(context).get(node.id).documents;
    expect(document?.title).toBe('Fiche composant');
    expect(new DocumentService(context).get(document!.id).body).toContain(
      '## Points d’attention',
    );
  });

  it('ne crée rien si le modèle n’existe pas', async () => {
    const { service, context } = workspace();
    const impl = implementations(service);
    expect(() =>
      impl['node:create']({
        parentId: null,
        title: 'Cache',
        nodeType: 'component',
        templateId: 'absent',
      }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(new NodeService(context).list()).toEqual([]);
  });

  it('crée un document depuis un modèle, avec le titre choisi', async () => {
    const { service, context } = workspace();
    const node = new NodeService(context).create({
      parentId: null,
      title: 'Choix de la base',
      nodeType: 'concept',
    });
    const document = await implementations(service)['document:create']({
      nodeId: node.id,
      title: 'ADR 001',
      contentType: 'markdown',
      templateId: 'adr',
    });
    expect(document.title).toBe('ADR 001');
    expect(document.body).toContain('## Alternatives');
  });
});

/** Export natif de l'espace de test dans un sous-dossier. */
async function exportTest() {
  const { service, context, dir } = workspace();
  const target = path.join(dir, 'exports');
  fs.mkdirSync(target, { recursive: true });
  const exported = await exportWorkspace(
    context(),
    service.getCurrent()!,
    target,
    { name: 'Nodal', version: 'test' },
  );
  return validateExportFolder(exported.folderPath);
}

describe('export et import natifs', () => {
  it('conservent les modèles propres à l’espace', async () => {
    const { context, dir } = workspace();
    saveTemplates(context(), [custom]);
    const validation = await exportTest();
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    expect(validation.manifest.templates).toEqual([custom]);

    const importer = new WorkspaceService();
    try {
      importer.importFrom(
        path.join(dir, 'importé'),
        validation.manifest,
        validation.root,
      );
      expect(readTemplates(importer.getContext())).toEqual({
        templates: [custom],
        customized: true,
      });
    } finally {
      importer.close();
    }
  });

  it('n’exportent pas les modèles par défaut', async () => {
    const validation = await exportTest();
    expect(validation.ok && validation.manifest.templates).toBeUndefined();
  });
});
