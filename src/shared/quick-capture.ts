/**
 * Capture rapide : raccourci global (format « accelerator » d'Electron),
 * libellés et limites partagés par main et renderer. Logique pure.
 */

/** Titre du nœud racine qui reçoit les captures. */
export const INBOX_TITLE = 'Boîte de réception';

/** Titre du document qui reçoit la note d'une capture. */
export const CAPTURE_NOTE_TITLE = 'Note';

export const QUICK_CAPTURE_DEFAULT_SHORTCUT = 'CommandOrControl+Shift+Space';

const MODIFIERS = ['CommandOrControl', 'Alt', 'Shift'] as const;
type Modifier = (typeof MODIFIERS)[number];

/** Touches acceptées après les modificateurs. */
const KEY_PATTERN = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space)$/;

/**
 * Raccourci global valide : un ou plusieurs modificateurs dans l'ordre
 * canonique, dont Ctrl ou Alt (Maj seule détournerait la saisie), puis une
 * touche. Les touches de fonction seules sont aussi acceptées.
 */
export function isValidAccelerator(value: string): boolean {
  const parts = value.split('+');
  const key = parts.pop() ?? '';
  if (!KEY_PATTERN.test(key)) return false;
  const modifiers = parts as Modifier[];
  if (modifiers.some((part) => !MODIFIERS.includes(part))) return false;
  // Ordre canonique, sans doublon.
  const ordered = MODIFIERS.filter((modifier) => modifiers.includes(modifier));
  if (ordered.join('+') !== modifiers.join('+')) return false;
  if (key.startsWith('F') && key.length > 1) return true;
  return modifiers.includes('CommandOrControl') || modifiers.includes('Alt');
}

export interface KeyCombo {
  key: string;
  /** `KeyboardEvent.code` : position de la touche (chiffres en AZERTY). */
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** Touche d'un événement clavier au format accelerator, ou `null`. */
function acceleratorKey(event: KeyCombo): string | null {
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
  if (digit) return digit[1]!;
  if (event.code === 'Space') return 'Space';
  if (/^F[0-9]{1,2}$/.test(event.key)) return event.key;
  return null;
}

/**
 * Raccourci saisi au clavier (enregistreur des préférences) ; `null` tant
 * que la combinaison n'est pas complète ou pas valide.
 */
export function acceleratorFromKeyboard(event: KeyCombo): string | null {
  const key = acceleratorKey(event);
  if (!key) return null;
  const modifiers: Modifier[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push('CommandOrControl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  const accelerator = [...modifiers, key].join('+');
  return isValidAccelerator(accelerator) ? accelerator : null;
}

const LABELS: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Maj',
  Space: 'Espace',
};

/** Libellé affiché : « Ctrl + Maj + Espace ». */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => LABELS[part] ?? part)
    .join(' + ');
}

/** Espace qui recevra la capture (nom affiché dans la fenêtre). */
export interface CaptureTarget {
  workspaceName: string;
  /** L'espace est ouvert dans la fenêtre principale. */
  open: boolean;
}

export interface CaptureInput {
  title: string;
  /** Note facultative, rangée dans un document Markdown. */
  note: string | null;
}

export interface CaptureResult {
  workspaceName: string;
  nodeId: string;
}

/**
 * Canaux IPC propres à la fenêtre de capture. Elle n'a accès à aucun autre,
 * sauf les préférences en lecture (accent, densité).
 */
export const CAPTURE_WINDOW_CHANNELS = [
  'capture:getTarget',
  'capture:submit',
] as const;
export const CAPTURE_WINDOW_SHARED_CHANNELS = ['preferences:get'] as const;
