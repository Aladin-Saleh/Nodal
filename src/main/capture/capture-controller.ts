/**
 * Capture rapide côté Electron : raccourci global (préférences) et fenêtre
 * de capture, unique et créée à la demande.
 */
import { globalShortcut, type BrowserWindow } from 'electron';
import type { AppPreferences } from '../../shared/preferences';
import type { CaptureInput, CaptureResult } from '../../shared/quick-capture';
import type { QuickCaptureControls } from '../ipc/register';
import { createCaptureWindow } from '../window';
import type { QuickCaptureService } from './quick-capture-service';

export interface CaptureControllerOptions {
  service: QuickCaptureService;
  /** Capture rangée dans l'espace ouvert : la fenêtre principale recharge. */
  onCapturedInOpenWorkspace(): void;
  /** Applique la taille du texte des préférences. */
  zoomFactor(): number;
}

export class CaptureController implements QuickCaptureControls {
  private window: BrowserWindow | null = null;
  private shortcut: string | null = null;

  constructor(private readonly options: CaptureControllerOptions) {}

  getWindow = (): BrowserWindow | null => this.window;

  target() {
    return this.options.service.target();
  }

  submit(input: CaptureInput): CaptureResult {
    const { open, ...result } = this.options.service.submit(input);
    if (open) this.options.onCapturedInOpenWorkspace();
    return result;
  }

  open(): void {
    const existing = this.window;
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return;
    }
    const window = createCaptureWindow();
    window.webContents.on('did-finish-load', () =>
      window.webContents.setZoomFactor(this.options.zoomFactor()),
    );
    window.on('closed', () => {
      if (this.window === window) this.window = null;
    });
    this.window = window;
  }

  shortcutRegistered(): boolean {
    return this.shortcut !== null;
  }

  /**
   * (Ré)enregistre le raccourci global selon les préférences. Un raccourci
   * déjà pris par une autre application n'est simplement pas actif.
   */
  applyPreferences(preferences: AppPreferences): void {
    const wanted = preferences.quickCapture
      ? preferences.quickCaptureShortcut
      : null;
    if (wanted === this.shortcut) return;
    this.release();
    if (!wanted) return;
    try {
      if (globalShortcut.register(wanted, () => this.open())) {
        this.shortcut = wanted;
      }
    } catch (error) {
      console.warn('[capture] raccourci global refusé', error);
    }
  }

  release(): void {
    if (this.shortcut) globalShortcut.unregister(this.shortcut);
    this.shortcut = null;
  }
}
