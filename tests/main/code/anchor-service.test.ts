import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODE_ROOTS_MAX } from '../../../src/shared/code-anchors';
import {
  CodeAnchorService,
  STALE_CACHE_MS,
} from '../../../src/main/code/code-anchor-service';
import {
  listAnchoredNodes,
  listAnchors,
  markReviewed,
  nodesForPaths,
  readCodeRoots,
  resolveCodeRoots,
  setAnchors,
  writeCodeRoots,
} from '../../../src/main/knowledge/anchor-service';
import { DocumentService } from '../../../src/main/knowledge/document-service';
import { healthReport } from '../../../src/main/knowledge/health-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

function createNode(title = 'Serveur MCP') {
  const { context } = workspace();
  return new NodeService(context).create({
    parentId: null,
    title,
    nodeType: 'component',
  }).id;
}

/** Fichier du dossier de code, avec une date de modification donnée. */
function write(root: string, relative: string, mtime: Date) {
  const file = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  fs.utimesSync(file, mtime, mtime);
}

describe('ancrage (base de données)', () => {
  it('normalise, dédoublonne et refuse les motifs invalides', () => {
    const { context } = workspace();
    const id = createNode();
    expect(
      setAnchors(context(), id, ['.\\src\\mcp\\**', 'src/mcp/**', 'README.md']),
    ).toEqual(['src/mcp/**', 'README.md']);
    expect(listAnchors(context(), id)).toEqual(['src/mcp/**', 'README.md']);
    expect(() => setAnchors(context(), id, ['../secret'])).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() => setAnchors(context(), 'inconnu', ['a'])).toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('retire les ancrages avec le nœud', () => {
    const { context } = workspace();
    const id = createNode();
    setAnchors(context(), id, ['src/**']);
    new NodeService(context).delete({ id, childrenStrategy: 'delete' });
    expect(
      context().db.prepare('SELECT count(*) AS n FROM node_anchor').get(),
    ).toEqual({ n: 0 });
  });

  it('prend pour date de référence le nœud, ses documents ou la vérification', () => {
    const { context } = workspace();
    const id = createNode();
    setAnchors(context(), id, ['src/**']);
    const first = listAnchoredNodes(context())[0]!.since;
    const doc = new DocumentService(context).create({
      nodeId: id,
      title: 'Notes',
      contentType: 'markdown',
    });
    const afterDoc = listAnchoredNodes(context())[0]!.since;
    expect(afterDoc > first).toBe(true);
    expect(afterDoc).toBe(doc.updatedAt);
    markReviewed(context(), id);
    expect(listAnchoredNodes(context())[0]!.since > afterDoc).toBe(true);
  });

  it('retrouve les nœuds ancrés à des chemins', () => {
    const { context } = workspace();
    const mcp = createNode('Serveur MCP');
    const db = createNode('Base');
    createNode('Sans ancrage');
    setAnchors(context(), mcp, ['src/mcp/**']);
    setAnchors(context(), db, ['src/main/database']);
    const found = nodesForPaths(context(), [
      'src/mcp/server.ts',
      'src/main/database/connection.ts',
      'README.md',
    ]);
    expect(found.map((item) => [item.node.title, item.paths])).toEqual([
      ['Serveur MCP', ['src/mcp/server.ts']],
      ['Base', ['src/main/database/connection.ts']],
    ]);
  });

  it('enregistre les dossiers de code ; un chemin relatif part du .nodal', () => {
    const { context, dir } = workspace();
    writeCodeRoots(context(), ['C:\\code', '../voisin']);
    expect(readCodeRoots(context())).toEqual(['C:\\code', '../voisin']);
    const file = path.join(dir, 'test.nodal');
    expect(resolveCodeRoots(['../voisin'], file)).toEqual([
      path.resolve(dir, '../voisin'),
    ]);
    expect(() =>
      writeCodeRoots(
        context(),
        Array.from({ length: CODE_ROOTS_MAX + 1 }, (_, i) => `/r${i}`),
      ),
    ).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });
});

/** Service applicatif sur l'espace de test, horloge du cache réglable. */
function service() {
  const { context, dir } = workspace();
  let clock = 0;
  const anchors = new CodeAnchorService(
    context,
    () => path.join(dir, 'test.nodal'),
    { clock: () => clock },
  );
  return {
    anchors,
    context,
    dir,
    advance: (ms: number) => (clock += ms),
  };
}

describe('CodeAnchorService', () => {
  it('ajoute et retire des dossiers de code, sans doublon', () => {
    const { anchors, dir } = service();
    const code = path.join(dir, 'code');
    fs.mkdirSync(code);
    anchors.addRoot(code);
    expect(anchors.addRoot(code)).toEqual([{ path: code, exists: true }]);
    expect(anchors.addRoot(path.join(dir, 'absent'))[1]).toEqual({
      path: path.join(dir, 'absent'),
      exists: false,
    });
    expect(anchors.removeRoot(path.join(dir, 'absent'))).toEqual([
      { path: code, exists: true },
    ]);
  });

  it('ancre des fichiers choisis par leur chemin relatif, refuse ceux hors des dossiers', () => {
    const { anchors, dir } = service();
    const code = path.join(dir, 'code');
    fs.mkdirSync(code);
    anchors.addRoot(code);
    const id = createNode();
    expect(anchors.addFiles(id, [path.join(code, 'src', 'a.ts')])).toEqual([
      'src/a.ts',
    ]);
    expect(() =>
      anchors.addFiles(id, [path.join(dir, 'ailleurs.ts')]),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('détecte la documentation obsolète, et « Marquer comme à jour » la retire', async () => {
    const { anchors, context, dir } = service();
    const code = path.join(dir, 'code');
    fs.mkdirSync(code);
    anchors.addRoot(code);
    const id = createNode();
    anchors.setAnchors(id, ['src/**', 'absent.ts']);
    // Horloge des tests : 2026-10-29 ; fichier modifié bien après.
    write(code, 'src/a.ts', new Date('2027-01-01T00:00:00Z'));

    const listed = await anchors.listForNode(id);
    expect(listed.hasRoots).toBe(true);
    expect(listed.anchors.map((a) => [a.pattern, a.count])).toEqual([
      ['src/**', 1],
      ['absent.ts', 0],
    ]);
    expect(listed.stale?.files.map((file) => file.path)).toEqual(['src/a.ts']);
    expect((await anchors.staleNodes()).map((node) => node.nodeId)).toEqual([
      id,
    ]);

    // Le rapport de santé reprend la vérification.
    const report = healthReport(context(), 50, await anchors.staleNodes());
    expect(report.checks.find((check) => check.id === 'stale')).toMatchObject({
      count: 1,
      issues: [{ nodeId: id, detail: 'src/a.ts' }],
    });
    expect(
      healthReport(context()).checks.some((check) => check.id === 'stale'),
    ).toBe(false);

    // Date de vérification encore antérieure au fichier : toujours obsolète.
    anchors.markReviewed(id);
    expect(await anchors.staleNodes()).toHaveLength(1);
    write(code, 'src/a.ts', new Date('2026-01-01T00:00:00Z'));
    anchors.markReviewed(id);
    expect(await anchors.staleNodes()).toEqual([]);
  });

  it('garde la vérification en cache tant que rien ne change', async () => {
    const { anchors, dir, advance } = service();
    const code = path.join(dir, 'code');
    fs.mkdirSync(code);
    anchors.addRoot(code);
    const id = createNode();
    anchors.setAnchors(id, ['src/**']);
    expect(await anchors.staleNodes()).toEqual([]);
    write(code, 'src/a.ts', new Date('2027-01-01T00:00:00Z'));
    expect(await anchors.staleNodes()).toEqual([]);
    advance(STALE_CACHE_MS + 1);
    expect(await anchors.staleNodes()).toHaveLength(1);
  });
});

describe('motifs modifiés hors de Nodal', () => {
  it('ignore un motif invalide écrit directement dans le fichier', () => {
    const { context } = workspace();
    const id = createNode();
    setAnchors(context(), id, ['src/**']);
    context()
      .db.prepare(
        "INSERT INTO node_anchor (node_id, pattern, sort_order, created_at) VALUES (?, '../../secret/**', 1, 't')",
      )
      .run(id);
    expect(listAnchors(context(), id)).toEqual(['src/**']);
    expect(listAnchoredNodes(context())[0]!.patterns).toEqual(['src/**']);
  });
});
