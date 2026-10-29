import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closeNodalDatabase,
  createNodalDatabase,
} from '../../../src/main/database/connection';
import { LATEST_SCHEMA_VERSION } from '../../../src/main/database/migrations';
import { listRelationTypes } from '../../../src/main/workspace/workspace-repository';
import {
  ensureNodalExtension,
  WorkspaceService,
} from '../../../src/main/workspace/workspace-service';
import { DEFAULT_RELATION_TYPES } from '../../../src/shared/domain';
import { listFiles, useTempDir } from '../../helpers/temp-dir';

const tempDir = useTempDir();
const services: WorkspaceService[] = [];

function newService() {
  let counter = 0;
  const service = new WorkspaceService({
    now: () => new Date('2026-10-29T12:00:00.000Z'),
    generateId: () => `id-${++counter}`,
  });
  services.push(service);
  return service;
}

afterEach(() => {
  services.splice(0).forEach((service) => service.close());
});

describe('ensureNodalExtension', () => {
  it('ajoute .nodal si besoin', () => {
    expect(ensureNodalExtension('C:/kb/base')).toBe('C:/kb/base.nodal');
    expect(ensureNodalExtension('C:/kb/base.NODAL')).toBe('C:/kb/base.NODAL');
    expect(ensureNodalExtension('C:/kb/base.db')).toBe('C:/kb/base.db.nodal');
  });
});

describe('WorkspaceService', () => {
  it('crée un espace avec ses types de relations par défaut', () => {
    const service = newService();
    const info = service.create(path.join(tempDir(), 'kb'), '  Ma base  ');

    expect(info).toEqual({
      id: 'id-1',
      name: 'Ma base',
      description: null,
      filePath: path.join(tempDir(), 'kb.nodal'),
      schemaVersion: LATEST_SCHEMA_VERSION,
      createdAt: '2026-10-29T12:00:00.000Z',
      updatedAt: '2026-10-29T12:00:00.000Z',
    });
    expect(service.getCurrent()).toEqual(info);

    const relationTypes = listRelationTypes(service.getDatabase(), info.id);
    expect(relationTypes.map((type) => type.name)).toEqual([
      ...DEFAULT_RELATION_TYPES,
    ]);
    expect(relationTypes.every((type) => type.is_builtin === 1)).toBe(true);
  });

  it('refuse un nom invalide sans créer de fichier', () => {
    const service = newService();
    expect(() =>
      service.create(path.join(tempDir(), 'kb.nodal'), '   '),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(listFiles(tempDir())).toEqual([]);
  });

  it('rouvre un espace après fermeture', () => {
    const filePath = path.join(tempDir(), 'kb.nodal');
    const service = newService();
    const created = service.create(filePath, 'Ma base');
    service.close();

    expect(service.getCurrent()).toBeNull();
    expect(listFiles(tempDir())).toEqual(['kb.nodal']);

    const reopened = newService().open(filePath);
    expect(reopened).toEqual(created);
  });

  it('ferme l’espace précédent lors de l’ouverture d’un autre', () => {
    const service = newService();
    service.create(path.join(tempDir(), 'a.nodal'), 'A');
    const b = service.create(path.join(tempDir(), 'b.nodal'), 'B');

    expect(service.getCurrent()).toEqual(b);
    // a.nodal est fermé (un seul fichier), b.nodal est ouvert (WAL actif).
    expect(listFiles(tempDir())).toEqual([
      'a.nodal',
      'b.nodal',
      'b.nodal-shm',
      'b.nodal-wal',
    ]);
  });

  it('garde l’espace courant si la création échoue', () => {
    const service = newService();
    const current = service.create(path.join(tempDir(), 'a.nodal'), 'A');

    expect(() =>
      service.create(path.join(tempDir(), 'a.nodal'), 'B'),
    ).toThrowError(expect.objectContaining({ code: 'FILE_ALREADY_EXISTS' }));
    expect(service.getCurrent()).toEqual(current);
  });

  it('rouvrir le fichier courant renvoie l’espace déjà ouvert', () => {
    const service = newService();
    const filePath = path.join(tempDir(), 'a.nodal');
    const created = service.create(filePath, 'A');
    expect(service.open(filePath)).toBe(created);
  });

  it('refuse un fichier Nodal sans espace', () => {
    const filePath = path.join(tempDir(), 'empty.nodal');
    closeNodalDatabase(createNodalDatabase(filePath));

    const service = newService();
    expect(() => service.open(filePath)).toThrowError(
      expect.objectContaining({ code: 'INVALID_WORKSPACE_FILE' }),
    );
    expect(service.getCurrent()).toBeNull();
    expect(listFiles(tempDir())).toEqual(['empty.nodal']);
  });

  it('signale l’absence d’espace ouvert', () => {
    expect(() => newService().getDatabase()).toThrowError(
      expect.objectContaining({ code: 'NO_WORKSPACE_OPEN' }),
    );
  });

  it('close() est sans effet sans espace ouvert', () => {
    expect(() => newService().close()).not.toThrow();
  });

  it('ne laisse pas de fichier si l’écriture initiale échoue', () => {
    const service = new WorkspaceService({
      generateId: () => 'same-id', // collision de clé primaire dès le 2e insert
    });
    services.push(service);
    expect(() =>
      service.create(path.join(tempDir(), 'kb.nodal'), 'KB'),
    ).toThrow(/UNIQUE constraint failed/);
    expect(fs.readdirSync(tempDir())).toEqual([]);
  });
});
