import { describe, expect, it } from 'vitest';
import {
  matchesAnchor,
  normalizeAnchorPattern,
  staticPrefix,
  toRootRelative,
} from '../../src/shared/code-anchors';

describe('normalizeAnchorPattern', () => {
  it('normalise séparateurs, ./ initial, // et / final', () => {
    expect(normalizeAnchorPattern(' .\\src\\\\mcp\\ ')).toEqual({
      ok: true,
      pattern: 'src/mcp',
    });
    expect(normalizeAnchorPattern('./src/mcp/**/')).toEqual({
      ok: true,
      pattern: 'src/mcp/**',
    });
  });

  it.each([
    ['', 'vide'],
    ['.', 'vide'],
    ['/etc/passwd', 'relatif'],
    ['C:\\Windows\\x', 'relatif'],
    ['src/../secret', '..'],
    ['src/[ab].ts', 'jokers'],
    ['src/{a,b}.ts', 'jokers'],
    ['!src', 'jokers'],
    [':(top)src', 'jokers'],
    ['src/\u0001', 'invalide'],
    ['a'.repeat(301), 'long'],
  ])('refuse %j', (raw, reason) => {
    expect(normalizeAnchorPattern(raw)).toEqual({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });
});

describe('matchesAnchor', () => {
  it('un chemin sans joker désigne le fichier ou tout le dossier', () => {
    expect(matchesAnchor('src/mcp', 'src/mcp')).toBe(true);
    expect(matchesAnchor('src/mcp', 'src/mcp/server.ts')).toBe(true);
    expect(matchesAnchor('src/mcp', 'src/mcp-old/a.ts')).toBe(false);
    expect(matchesAnchor('README.md', 'README.md')).toBe(true);
  });

  it('suit la syntaxe des pathspecs :(glob) de git', () => {
    expect(matchesAnchor('src/mcp/**', 'src/mcp/a/b/c.ts')).toBe(true);
    expect(matchesAnchor('src/mcp/**', 'src/mcpx/a.ts')).toBe(false);
    expect(matchesAnchor('src/*.ts', 'src/a.ts')).toBe(true);
    expect(matchesAnchor('src/*.ts', 'src/sub/a.ts')).toBe(false);
    expect(matchesAnchor('**/test.ts', 'test.ts')).toBe(true);
    expect(matchesAnchor('**/test.ts', 'a/b/test.ts')).toBe(true);
    expect(matchesAnchor('a/**/b.ts', 'a/b.ts')).toBe(true);
    expect(matchesAnchor('a/**/b.ts', 'a/x/y/b.ts')).toBe(true);
    expect(matchesAnchor('src/?.ts', 'src/a.ts')).toBe(true);
    expect(matchesAnchor('src/?.ts', 'src/ab.ts')).toBe(false);
    expect(matchesAnchor('src/a.ts', 'src/a+ts')).toBe(false);
  });

  it('respecte la casse sauf sur demande', () => {
    expect(matchesAnchor('src/A.ts', 'src/a.ts')).toBe(false);
    expect(matchesAnchor('src/A.ts', 'src/a.ts', true)).toBe(true);
  });
});

describe('staticPrefix', () => {
  it('garde les dossiers avant le premier joker', () => {
    expect(staticPrefix('src/mcp/**')).toBe('src/mcp');
    expect(staticPrefix('src/*/x.ts')).toBe('src');
    expect(staticPrefix('**/x.ts')).toBe('');
    expect(staticPrefix('src/a.ts')).toBe('src/a.ts');
  });
});

describe('toRootRelative', () => {
  const roots = ['C:\\dev\\app', 'C:\\dev\\app\\packages\\lib'];

  it('rend un chemin absolu relatif au dossier le plus profond', () => {
    expect(toRootRelative('C:\\dev\\app\\src\\a.ts', roots)).toEqual({
      root: 'C:\\dev\\app',
      path: 'src/a.ts',
    });
    expect(toRootRelative('C:/dev/app/packages/lib/x.ts', roots)).toEqual({
      root: 'C:\\dev\\app\\packages\\lib',
      path: 'x.ts',
    });
  });

  it('compare sans casse sur demande, refuse un chemin hors des dossiers', () => {
    expect(toRootRelative('c:\\DEV\\app\\a.ts', roots)).toBeNull();
    expect(toRootRelative('c:\\DEV\\app\\a.ts', roots, true)?.path).toBe(
      'a.ts',
    );
    expect(toRootRelative('C:\\dev\\application\\a.ts', roots)).toBeNull();
    expect(toRootRelative('D:\\autre\\a.ts', roots)).toBeNull();
  });

  it('normalise seulement un chemin relatif', () => {
    expect(toRootRelative('.\\src\\a.ts', roots)).toEqual({
      root: null,
      path: 'src/a.ts',
    });
  });
});
