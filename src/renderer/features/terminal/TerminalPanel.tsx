import { useCallback, useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalEvent, TerminalSession } from '../../../shared/terminal';
import { useClient } from '../../app/context';

/** Hauteur du panneau (px), mémorisée pour ce poste. */
const HEIGHT_KEY = 'nodal.terminal.height';
const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;

function savedHeight(): number {
  try {
    const value = Number(localStorage.getItem(HEIGHT_KEY));
    return value >= MIN_HEIGHT ? value : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

/** Couleurs du terminal : sombres dans les deux thèmes, comme une console. */
const THEME = {
  background: '#17181b',
  foreground: '#e6e7ea',
  cursor: '#e6e7ea',
  selectionBackground: '#3b5bdb80',
};

export interface TerminalPanelProps {
  /** Masqué : la session continue (le panneau reste monté). */
  visible: boolean;
  onHide(): void;
  /** Raccourci d'ouverture / fermeture, affiché dans l'infobulle. */
  shortcut?: string;
}

/**
 * Terminal intégré (xterm.js) relié à un shell du main (node-pty) : dossier
 * de code de l'espace, variable NODAL_WORKSPACE. Ctrl+C copie la sélection
 * (sinon interrompt), Ctrl+V colle.
 */
export function TerminalPanel({
  visible,
  onHide,
  shortcut,
}: TerminalPanelProps) {
  const client = useClient();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
  const sessionId = useRef<string | null>(null);
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [exited, setExited] = useState<number | null>(null);
  const [height, setHeight] = useState(savedHeight);
  const [restarts, setRestarts] = useState(0);

  /** Ajuste la taille en caractères au panneau et la transmet au shell. */
  const fit = useCallback(() => {
    const current = terminal.current;
    if (!current || !host.current?.offsetParent) return;
    current.fit.fit();
    const id = sessionId.current;
    if (id) {
      void client
        .call('terminal:resize', {
          id,
          cols: current.term.cols,
          rows: current.term.rows,
        })
        .catch(() => undefined);
    }
  }, [client]);

  // Terminal xterm : créé une fois.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: THEME,
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.open(element);
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey) return true;
      const key = event.key.toLowerCase();
      if (key === 'c' && term.hasSelection()) {
        void navigator.clipboard
          .writeText(term.getSelection())
          .catch(() => undefined);
        term.clearSelection();
        return false;
      }
      // Ctrl+V : collage par le navigateur ; Ctrl+J : masquer le panneau.
      return key !== 'v' && key !== 'j';
    });
    terminal.current = { term, fit: addon };
    const observer = new ResizeObserver(() => fit());
    observer.observe(element);
    return () => {
      observer.disconnect();
      term.dispose();
      terminal.current = null;
    };
  }, [fit]);

  // Session du shell : ouverte au montage et à chaque redémarrage.
  useEffect(() => {
    const current = terminal.current;
    if (!current) return;
    const { term } = current;
    let id: string | null = null;
    let cancelled = false;
    // Sorties reçues avant la réponse de terminal:create.
    const early: TerminalEvent[] = [];
    const apply = (event: TerminalEvent) => {
      if (event.kind === 'data') term.write(event.data);
      else {
        term.write(
          `\r\n\x1b[90m[Processus terminé, code ${event.exitCode}]\x1b[0m\r\n`,
        );
        sessionId.current = null;
        setExited(event.exitCode);
      }
    };
    const off = client.onTerminalEvent((event) => {
      if (id === null) early.push(event);
      else if (event.id === id) apply(event);
    });
    const input = term.onData((data) => {
      if (id)
        void client.call('terminal:write', { id, data }).catch(() => undefined);
    });
    // Redémarrage : écran effacé avant le nouveau shell.
    if (restarts > 0) term.reset();
    setExited(null);
    if (host.current?.offsetParent) current.fit.fit();
    client.call('terminal:create', { cols: term.cols, rows: term.rows }).then(
      (created) => {
        if (cancelled) {
          void client.call('terminal:close', { id: created.id });
          return;
        }
        id = created.id;
        sessionId.current = created.id;
        setSession(created);
        for (const event of early) if (event.id === created.id) apply(event);
        fit();
      },
      (error: unknown) => {
        term.write(
          `\x1b[31mTerminal indisponible : ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`,
        );
      },
    );
    return () => {
      cancelled = true;
      off();
      input.dispose();
      if (id) void client.call('terminal:close', { id }).catch(() => undefined);
      sessionId.current = null;
    };
  }, [client, fit, restarts]);

  // Affiché : taille à jour et focus dans le terminal.
  useEffect(() => {
    if (!visible) return;
    fit();
    terminal.current?.term.focus();
  }, [visible, fit]);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const max = Math.round(window.innerHeight * 0.75);
    let next = startHeight;
    const onMove = (move: PointerEvent) => {
      next = Math.min(
        max,
        Math.max(MIN_HEIGHT, startHeight + startY - move.clientY),
      );
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      try {
        localStorage.setItem(HEIGHT_KEY, String(next));
      } catch {
        // Hauteur non mémorisée.
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <section
      className="terminal-panel"
      aria-label="Terminal"
      hidden={!visible}
      style={{ height }}
    >
      <div
        className="terminal-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Redimensionner le terminal"
        onPointerDown={startResize}
      />
      <header className="terminal-header">
        <strong>Terminal</strong>
        {session && (
          <span className="muted terminal-cwd" title={session.cwd}>
            {session.shell} · {session.cwd}
          </span>
        )}
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="secondary"
          title={
            exited === null
              ? 'Arrêter le shell et en lancer un nouveau'
              : undefined
          }
          onClick={() => setRestarts((count) => count + 1)}
        >
          {exited === null ? 'Redémarrer' : 'Relancer'}
        </button>
        <button
          type="button"
          className="secondary icon-button"
          aria-label="Masquer le terminal"
          title={shortcut ? `Masquer (${shortcut})` : 'Masquer'}
          onClick={onHide}
        >
          ×
        </button>
      </header>
      <div className="terminal-host" ref={host} />
    </section>
  );
}
