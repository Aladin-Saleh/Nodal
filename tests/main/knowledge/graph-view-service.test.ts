import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  runMigrations,
} from '../../../src/main/database/migrations';
import {
  GRAPH_VIEW_LIMIT,
  GraphViewService,
} from '../../../src/main/knowledge/graph-view-service';
import type { GraphCamera, GraphViewSettings } from '../../../src/shared/model';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

const settings: GraphViewSettings = {
  scope: 'neighborhood',
  depth: 3,
  nodeTypes: ['data'],
  tagIds: [],
  hiddenRelationTypeIds: [],
  showHierarchy: false,
  collapsed: ['n1'],
  hidden: ['n2'],
  solo: null,
  assistantPendingOnly: false,
};
const camera: GraphCamera = { position: [0, 60, 320], target: [1, 2, 3] };

describe('vues graphe enregistrées', () => {
  it('se créent, se relisent, se renomment et se mettent à jour', () => {
    const views = new GraphViewService(workspace().context);
    expect(views.list()).toEqual([]);
    const created = views.create({ name: 'Infra', settings, camera });
    expect(created).toMatchObject({
      name: 'Infra',
      settings,
      camera,
      isDefault: false,
    });
    const second = views.create({ name: 'Données', settings, camera: null });
    expect(views.list().map((view) => view.name)).toEqual(['Infra', 'Données']);

    const renamed = views.update({ id: created.id, name: 'Infrastructure' });
    expect(renamed).toMatchObject({ name: 'Infrastructure', camera });
    const updated = views.update({
      id: second.id,
      settings: { ...settings, depth: 1 },
      camera,
    });
    expect(updated.settings.depth).toBe(1);
    expect(updated.camera).toEqual(camera);
    expect(updated.updatedAt > second.updatedAt).toBe(true);
  });

  it('refusent un nom déjà pris (sans tenir compte de la casse)', () => {
    const views = new GraphViewService(workspace().context);
    const first = views.create({ name: 'Infra', settings, camera: null });
    const other = views.create({ name: 'Autre', settings, camera: null });
    expect(() =>
      views.create({ name: 'INFRA', settings, camera: null }),
    ).toThrowError(expect.objectContaining({ code: 'CONFLICT' }));
    expect(() => views.update({ id: other.id, name: 'infra' })).toThrowError(
      expect.objectContaining({ code: 'CONFLICT' }),
    );
    // Renommer une vue avec son propre nom (autre casse) est permis.
    expect(views.update({ id: first.id, name: 'INFRA' }).name).toBe('INFRA');
  });

  it('une seule vue par défaut ; null pour n’en garder aucune', () => {
    const views = new GraphViewService(workspace().context);
    const a = views.create({ name: 'A', settings, camera: null });
    const b = views.create({ name: 'B', settings, camera: null });
    views.setDefault(a.id);
    views.setDefault(b.id);
    expect(views.list().map((view) => view.isDefault)).toEqual([false, true]);
    views.setDefault(null);
    expect(views.list().some((view) => view.isDefault)).toBe(false);
    expect(() => views.setDefault('inconnue')).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('se suppriment ; une vue inconnue est signalée', () => {
    const views = new GraphViewService(workspace().context);
    const view = views.create({ name: 'A', settings, camera: null });
    views.delete(view.id);
    expect(views.list()).toEqual([]);
    expect(() => views.delete(view.id)).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('ignorent une vue dont le JSON est illisible, et la caméra illisible', () => {
    const { context } = workspace();
    const views = new GraphViewService(context);
    const good = views.create({ name: 'A', settings, camera });
    const bad = views.create({ name: 'B', settings, camera: null });
    const db = context().db;
    db.prepare('UPDATE graph_view SET settings = ? WHERE id = ?').run(
      '{pas du json',
      bad.id,
    );
    db.prepare('UPDATE graph_view SET camera = ? WHERE id = ?').run(
      '{"position":[1,2]}',
      good.id,
    );
    expect(views.list()).toEqual([
      expect.objectContaining({ id: good.id, camera: null }),
    ]);
  });

  it('sont limitées en nombre', () => {
    const views = new GraphViewService(workspace().context);
    for (let i = 0; i < GRAPH_VIEW_LIMIT; i++) {
      views.create({ name: `V${i}`, settings, camera: null });
    }
    expect(() =>
      views.create({ name: 'Une de trop', settings, camera: null }),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });
});

describe('migration 006', () => {
  const now = '2026-10-29T12:00:00.000Z';

  function migratedFrom5(withSettings: boolean) {
    const db = new DatabaseSync(':memory:');
    runMigrations(db, MIGRATIONS.slice(0, 5));
    db.prepare(
      'INSERT INTO workspace (id, name, description, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)',
    ).run('w1', 'Espace', now, now);
    if (withSettings) {
      db.prepare(
        'INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)',
      ).run('w1', 'view.graph', JSON.stringify(settings));
    }
    runMigrations(db);
    return db;
  }

  it('transforme les réglages actuels en vue « Par défaut »', () => {
    const db = migratedFrom5(true);
    const views = new GraphViewService(() => ({
      db,
      workspaceId: 'w1',
      now: () => now,
      newId: () => 'x',
    })).list();
    expect(views).toEqual([
      expect.objectContaining({
        name: 'Par défaut',
        settings,
        camera: null,
        isDefault: true,
      }),
    ]);
    expect(views[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // L'état de travail reste en place.
    expect(
      db
        .prepare(
          "SELECT count(*) AS n FROM workspace_settings WHERE key = 'view.graph'",
        )
        .get(),
    ).toEqual({ n: 1 });
    db.close();
  });

  it('ne crée aucune vue sans réglages enregistrés', () => {
    const db = migratedFrom5(false);
    expect(db.prepare('SELECT count(*) AS n FROM graph_view').get()).toEqual({
      n: 0,
    });
    db.close();
  });
});
