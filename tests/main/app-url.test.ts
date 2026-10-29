import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAppUrlMatcher, isExternalWebUrl } from '../../src/main/app-url';

const indexPath = path.resolve('build/renderer/main_window/index.html');

describe('createAppUrlMatcher', () => {
  it('en développement, accepte uniquement l’origine du serveur Vite', () => {
    const isAppUrl = createAppUrlMatcher({
      devServerUrl: 'http://localhost:5173',
      rendererIndexPath: indexPath,
    });
    expect(isAppUrl('http://localhost:5173/')).toBe(true);
    expect(isAppUrl('http://localhost:5173/src/main.tsx')).toBe(true);
    expect(isAppUrl('http://localhost:5174/')).toBe(false);
    expect(isAppUrl('https://example.com/')).toBe(false);
  });

  it('en production, accepte uniquement l’index.html du renderer', () => {
    const isAppUrl = createAppUrlMatcher({
      devServerUrl: undefined,
      rendererIndexPath: indexPath,
    });
    const indexUrl = pathToFileURL(indexPath).href;
    expect(isAppUrl(indexUrl)).toBe(true);
    expect(isAppUrl(`${indexUrl}#/workspace`)).toBe(true);
    expect(isAppUrl(pathToFileURL(path.resolve('evil.html')).href)).toBe(false);
    expect(isAppUrl('https://example.com/')).toBe(false);
    expect(isAppUrl('not a url')).toBe(false);
  });
});

describe('isExternalWebUrl', () => {
  it.each([
    ['https://example.com', true],
    ['http://example.com', true],
    ['file:///C:/Windows/System32/calc.exe', false],
    ['javascript:alert(1)', false],
    ['ms-settings:', false],
    ['', false],
  ])('%s → %s', (url, expected) => {
    expect(isExternalWebUrl(url)).toBe(expected);
  });
});
