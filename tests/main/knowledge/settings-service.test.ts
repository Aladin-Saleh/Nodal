import { describe, expect, it } from 'vitest';
import { exportWorkspace } from '../../../src/main/knowledge/export-service';
import { SettingsService } from '../../../src/main/knowledge/settings-service';
import type { GraphViewSettings } from '../../../src/shared/model';
import { testWorkspaceFixture } from '../../helpers/test-workspace';
import fs from 'node:fs';
import path from 'node:path';

const workspace = testWorkspaceFixture();

const view: GraphViewSettings = {
  scope: 'neighborhood',
  depth: 3,
  nodeTypes: ['data'],
  tagIds: ['t1'],
  hiddenRelationTypeIds: [],
  showHierarchy: false,
  collapsed: ['n1', 'n2'],
};

describe('réglages d’affichage du graphe', () => {
  it('sont absents tant que rien n’a été enregistré', () => {
    expect(new SettingsService(workspace().context).getGraphView()).toBeNull();
  });

  it('sont enregistrés puis relus, et remplacés au prochain enregistrement', () => {
    const settings = new SettingsService(workspace().context);
    settings.saveGraphView(view);
    expect(settings.getGraphView()).toEqual(view);
    settings.saveGraphView({ ...view, depth: 1, collapsed: [] });
    expect(settings.getGraphView()).toMatchObject({ depth: 1, collapsed: [] });
  });

  it('retombent sur « aucun réglage » si la valeur stockée est illisible', () => {
    const { context } = workspace();
    const ctx = context();
    const settings = new SettingsService(context);
    const store = (value: string) =>
      ctx.db
        .prepare(
          `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, 'view.graph', ?)
           ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value`,
        )
        .run(ctx.workspaceId, value);
    store('{pas du json');
    expect(settings.getGraphView()).toBeNull();
    store(JSON.stringify({ ...view, depth: 42 }));
    expect(settings.getGraphView()).toBeNull();
  });

  it('refusent des réglages invalides à l’écriture', () => {
    const settings = new SettingsService(workspace().context);
    expect(() =>
      settings.saveGraphView({ ...view, scope: 'partout' } as never),
    ).toThrow(/scope/);
  });

  it('ne font pas partie des paramètres de l’espace ni de l’export', async () => {
    const { context, dir, service } = workspace();
    const settings = new SettingsService(context);
    settings.saveGraphView(view);
    expect(settings.get()).not.toHaveProperty('graphView');
    const exported = await exportWorkspace(
      context(),
      service.getCurrent()!,
      dir,
      { name: 'Nodal', version: 'test' },
    );
    const manifest = fs.readFileSync(
      path.join(exported.folderPath, 'manifest.json'),
      'utf8',
    );
    expect(manifest).not.toContain('view.graph');
    expect(manifest).not.toContain('collapsed');
  });
});
