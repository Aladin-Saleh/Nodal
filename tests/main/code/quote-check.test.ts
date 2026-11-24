import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyQuote } from '../../../src/main/code/quote-check';
import { useTempDir } from '../../helpers/temp-dir';

const tempDir = useTempDir();

describe('citation vérifiée', () => {
  const setup = () => {
    const root = path.join(tempDir(), 'app');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      'export function lire(\n  chemin: string,\n) {}\n',
    );
    fs.writeFileSync(path.join(root, '..', 'secret.txt'), 'mot de passe');
    return (source: string, quote: string | null) =>
      verifyQuote([root], source, quote, false);
  };

  it('retrouve la citation, aux espaces près, avec ou sans ligne', () => {
    const check = setup();
    expect(check('src/a.ts', 'function lire( chemin: string,')).toBe(true);
    expect(check('src/a.ts:1-3', 'export function lire')).toBe(true);
    expect(check('src/a.ts#L1', 'export function lire')).toBe(true);
    expect(check('src/a.ts', 'function ecrire(')).toBe(false);
  });

  it('ne dit rien de ce qu’elle ne peut pas vérifier', () => {
    const check = setup();
    expect(check('src/a.ts', null)).toBeNull();
    expect(check('src/a.ts', 'lire')).toBeNull();
    expect(check('src/absent.ts', 'export function')).toBeNull();
    expect(check('https://a.b/c', 'export function')).toBeNull();
    expect(check('../secret.txt', 'mot de passe')).toBeNull();
  });
});
