import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PreferencesStore,
  WindowStateStore,
} from '../../src/main/preferences-store';
import { DEFAULT_PREFERENCES, stepZoom } from '../../src/shared/preferences';
import { useTempDir } from '../helpers/temp-dir';

const tempDir = useTempDir();

describe('PreferencesStore', () => {
  it('donne les valeurs par défaut sans fichier', () => {
    const store = new PreferencesStore(path.join(tempDir(), 'p.json'));
    expect(store.get()).toEqual(DEFAULT_PREFERENCES);
  });

  it('enregistre une modification et la relit', () => {
    const file = path.join(tempDir(), 'p.json');
    new PreferencesStore(file).update({ theme: 'light', accent: 'teal' });
    expect(new PreferencesStore(file).get()).toMatchObject({
      theme: 'light',
      accent: 'teal',
      density: 'comfortable',
    });
  });

  it('ignore une valeur invalide sans perdre les autres', () => {
    const file = path.join(tempDir(), 'p.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ theme: 'dark', accent: 'fluo', zoom: 333, extra: 1 }),
    );
    expect(new PreferencesStore(file).get()).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'dark',
    });
  });

  it('résiste à un fichier corrompu', () => {
    const file = path.join(tempDir(), 'p.json');
    fs.writeFileSync(file, '{ pas du json');
    expect(new PreferencesStore(file).get()).toEqual(DEFAULT_PREFERENCES);
  });

  it('refuse une modification invalide', () => {
    const store = new PreferencesStore(path.join(tempDir(), 'p.json'));
    expect(() => store.update({ zoom: 333 as never })).toThrow(/zoom/);
    expect(store.get()).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('stepZoom', () => {
  it('passe au niveau voisin, sans dépasser les bornes', () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(150, 1)).toBe(150);
    expect(stepZoom(80, -1)).toBe(80);
  });
});

describe('WindowStateStore', () => {
  it('relit l’état enregistré et ignore un état invalide', () => {
    const file = path.join(tempDir(), 'w.json');
    const store = new WindowStateStore(file);
    expect(store.get()).toBeNull();
    const state = { x: 10, y: 20, width: 1200, height: 800, maximized: true };
    store.save(state);
    expect(store.get()).toEqual(state);
    fs.writeFileSync(file, JSON.stringify({ ...state, width: 'large' }));
    expect(store.get()).toBeNull();
  });
});
