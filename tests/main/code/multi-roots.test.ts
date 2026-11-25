import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { CodeAnchorService } from '../../../src/main/code/code-anchor-service';
import { currentFingerprints } from '../../../src/main/code/code-check';
import {
  nodesForPaths,
  setAnchors,
} from '../../../src/main/knowledge/anchor-service';
import { NodeService } from '../../../src/main/knowledge/node-service';
import {
  matchesAnchor,
  normalizeAnchorPattern,
  qualifiedPath,
} from '../../../src/shared/code-anchors';
import { testWorkspaceFixture } from '../../helpers/test-workspace';

const workspace = testWorkspaceFixture();

it('un motif peut viser un seul dossier de code', () => {
  expect(normalizeAnchorPattern('api:./src\\a.ts')).toEqual({
    ok: true,
    pattern: 'api:src/a.ts',
  });
  for (const bad of ['api:../x', 'api:/etc', 'api:C:/x', 'api:', 'api:a/../b'])
    expect(normalizeAnchorPattern(bad).ok).toBe(false);
  expect(matchesAnchor('api:src/**', 'api:src/a.ts')).toBe(true);
  expect(matchesAnchor('api:src/**', 'web:src/a.ts')).toBe(false);
  expect(matchesAnchor('src/**', 'web:src/a.ts')).toBe(true);
  expect(matchesAnchor('api:src/**', 'src/a.ts')).toBe(true);
});

it('qualifiedPath précise le dossier s’il y en a plusieurs', () => {
  const roots = ['C:/dev/api', 'C:/dev/web'];
  expect(qualifiedPath('C:\\dev\\web\\a.ts', roots)).toBe('web:a.ts');
  expect(qualifiedPath('src/**', roots)).toBe('src/**');
  expect(qualifiedPath('src/**', roots, true, 'C:/dev/API/sub')).toBe(
    'api:src/**',
  );
  expect(qualifiedPath('web:src\\a.ts', roots)).toBe('web:src/a.ts');
  expect(qualifiedPath('C:/dev/api/a.ts', ['C:/dev/api'])).toBe('a.ts');
  expect(qualifiedPath('C:/ailleurs/a.ts', roots)).toBeNull();
});

it('deux dépôts aux mêmes chemins ne se mélangent pas', async () => {
  const { context, dir } = workspace();
  const roots = ['api', 'web'].map((name) => {
    const root = path.join(dir, name);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), name);
    return root;
  });
  const nodes = new NodeService(context);
  const create = (title: string) =>
    nodes.create({ parentId: null, title, nodeType: 'component' }).id;
  const api = create('API');
  const web = create('Web');
  const service = new CodeAnchorService(context, () =>
    path.join(dir, 'test.nodal'),
  );
  service.addRoot(roots[0]!);
  setAnchors(context(), api, ['src/**']);
  // Second dossier : l'ancrage du premier lui reste propre.
  service.addRoot(roots[1]!);
  expect(() =>
    service.addRoot(path.join(dir, 'x', 'API'.toLowerCase())),
  ).toThrow(/porte déjà ce nom/);
  expect(service.addFiles(web, [path.join(roots[1]!, 'src', 'a.ts')])).toEqual([
    'web:src/a.ts',
  ]);
  const found = (file: string) =>
    nodesForPaths(context(), [file]).map(({ node }) => node.title);
  expect(found('api:src/a.ts')).toEqual(['API']);
  expect(found('web:src/a.ts')).toEqual(['Web']);
  const prints = await currentFingerprints(roots, [
    { nodeId: api, patterns: ['api:src/**'] },
  ]);
  expect(Object.keys(prints.get(api)!)).toEqual(['api/src/a.ts']);
  const { anchors } = await service.listForNode(api);
  expect(anchors).toMatchObject([
    { pattern: 'api:src/**', files: ['api/src/a.ts'], count: 1 },
  ]);
});
