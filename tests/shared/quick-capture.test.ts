import { describe, expect, it } from 'vitest';
import { captureInputSchema } from '../../src/shared/ipc-schemas';
import {
  DEFAULT_PREFERENCES,
  preferencesSchema,
} from '../../src/shared/preferences';
import {
  acceleratorFromKeyboard,
  formatAccelerator,
  isValidAccelerator,
  QUICK_CAPTURE_DEFAULT_SHORTCUT,
  type KeyCombo,
} from '../../src/shared/quick-capture';

const key = (overrides: Partial<KeyCombo>): KeyCombo => ({
  key: '',
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe('isValidAccelerator', () => {
  it.each([
    QUICK_CAPTURE_DEFAULT_SHORTCUT,
    'CommandOrControl+Alt+N',
    'Alt+1',
    'F9',
    'Shift+F12',
  ])('accepte %s', (value) => {
    expect(isValidAccelerator(value)).toBe(true);
  });

  it.each([
    ['sans modificateur', 'N'],
    ['Maj seule', 'Shift+N'],
    ['ordre non canonique', 'Shift+CommandOrControl+N'],
    ['modificateur inconnu', 'Super+N'],
    ['doublon', 'Alt+Alt+N'],
    ['touche inconnue', 'CommandOrControl+Enter'],
    ['vide', ''],
  ])('refuse un raccourci %s', (_label, value) => {
    expect(isValidAccelerator(value)).toBe(false);
  });
});

describe('acceleratorFromKeyboard', () => {
  it('compose les modificateurs dans l’ordre canonique', () => {
    expect(
      acceleratorFromKeyboard(
        key({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe('CommandOrControl+Shift+Space');
  });

  it('lit les chiffres par leur position (AZERTY)', () => {
    expect(
      acceleratorFromKeyboard(key({ key: '&', code: 'Digit1', altKey: true })),
    ).toBe('Alt+1');
  });

  it('garde la lettre produite par la disposition du clavier', () => {
    expect(
      acceleratorFromKeyboard(key({ key: 'a', code: 'KeyQ', ctrlKey: true })),
    ).toBe('CommandOrControl+A');
  });

  it('attend une combinaison complète et valide', () => {
    expect(
      acceleratorFromKeyboard(
        key({ key: 'Control', code: 'ControlLeft', ctrlKey: true }),
      ),
    ).toBeNull();
    expect(acceleratorFromKeyboard(key({ key: 'n', code: 'KeyN' }))).toBeNull();
  });
});

describe('formatAccelerator', () => {
  it('affiche les libellés français', () => {
    expect(formatAccelerator(QUICK_CAPTURE_DEFAULT_SHORTCUT)).toBe(
      'Ctrl + Maj + Espace',
    );
  });
});

describe('préférences de capture', () => {
  it('active la capture par défaut avec Ctrl+Maj+Espace', () => {
    expect(DEFAULT_PREFERENCES.quickCapture).toBe(true);
    expect(preferencesSchema.safeParse(DEFAULT_PREFERENCES).success).toBe(true);
  });

  it('refuse un raccourci invalide', () => {
    expect(
      preferencesSchema.safeParse({
        ...DEFAULT_PREFERENCES,
        quickCaptureShortcut: 'N',
      }).success,
    ).toBe(false);
  });
});

describe('captureInputSchema', () => {
  it('normalise le titre et une note vide', () => {
    expect(captureInputSchema.parse({ title: '  Idée ', note: '  ' })).toEqual({
      title: 'Idée',
      note: null,
    });
  });

  it('refuse un titre vide ou une propriété inconnue', () => {
    expect(
      captureInputSchema.safeParse({ title: ' ', note: null }).success,
    ).toBe(false);
    expect(
      captureInputSchema.safeParse({ title: 'x', note: null, parentId: 'n' })
        .success,
    ).toBe(false);
  });
});
