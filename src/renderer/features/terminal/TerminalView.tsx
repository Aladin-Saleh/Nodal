import { useCallback, useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { NODE_LINK_PATTERN } from '../../../shared/node-links';
import type { TerminalEvent, TerminalSession } from '../../../shared/terminal';
import { useClient } from '../../app/context';

/** Couleurs du terminal : sombres dans les deux thèmes, comme une console. */
const THEME = {
  background: '#17181b',
  foreground: '#e6e7ea',
  cursor: '#e6e7ea',
  selectionBackground: '#3b5bdb80',
};

export interface TerminalViewProps {
  /** Onglet de ce terminal. */
  tabKey: number;
  /** Shell demandé ; `null` : celui par défaut. */
  shell: string | null;
  /**
   * Dossier de code où lancer le shell ; `null` : celui par défaut. Lu au
   * lancement seulement : en changer ne relance pas le shell.
   */
  folder: string | null;
  /** Onglet actif (affiché si le panneau l'est) ; sinon la session continue. */
  active: boolean;
  /** Onglet actif d'un panneau affiché. */
  visible: boolean;
  /** Nombre de redémarrages demandés : chacun lance un nouveau shell. */
  restarts: number;
  /** Fonctions stables : en changer relancerait le shell. */
  onSession(tabKey: number, session: TerminalSession): void;
  /** `asked` : sans erreur, après une saisie (`exit`). */
  onExit(tabKey: number, asked: boolean): void;
}

/**
 * Un terminal (xterm.js) relié à un shell du main (node-pty) : dossier de
 * code de l'espace, variable NODAL_WORKSPACE. Ctrl+C copie la sélection
 * (sinon interrompt), Ctrl+V colle.
 */
export function TerminalView({
  tabKey,
  shell,
  folder,
  active,
  visible,
  restarts,
  onSession,
  onExit,
}: TerminalViewProps) {
  const client = useClient();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
  const sessionId = useRef<string | null>(null);
  const folderRef = useRef(folder);
  useEffect(() => {
    folderRef.current = folder;
  });

  const openNodeLink = useCallback(
    (url: string) =>
      void client.call('link:open', { url }).catch(() => undefined),
    [client],
  );

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
      // Liens OSC 8 (assistants) : nodal:// ouvert dans Nodal, le reste par
      // le navigateur (window.open, filtré par le main).
      linkHandler: {
        activate: (_event, text) => {
          if (text.startsWith('nodal://')) openNodeLink(text);
          else window.open(text);
        },
      },
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
    // Liens nodal:// écrits en clair : cliquables.
    const links = term.registerLinkProvider({
      provideLinks(y, callback) {
        const line =
          term.buffer.active.getLine(y - 1)?.translateToString(true) ?? '';
        const found = [...line.matchAll(NODE_LINK_PATTERN)].map((match) => ({
          range: {
            start: { x: match.index + 1, y },
            end: { x: match.index + match[0].length, y },
          },
          text: match[0],
          activate: () => openNodeLink(match[0]),
        }));
        callback(found.length > 0 ? found : undefined);
      },
    });
    terminal.current = { term, fit: addon };
    const observer = new ResizeObserver(() => fit());
    observer.observe(element);
    return () => {
      observer.disconnect();
      links.dispose();
      term.dispose();
      terminal.current = null;
    };
  }, [fit, openNodeLink]);

  // Session du shell : ouverte au montage et à chaque redémarrage.
  useEffect(() => {
    const current = terminal.current;
    if (!current) return;
    const { term } = current;
    let id: string | null = null;
    let cancelled = false;
    let typed = false;
    // Sorties reçues avant la réponse de terminal:create.
    const early: TerminalEvent[] = [];
    const apply = (event: TerminalEvent) => {
      if (event.kind === 'data') term.write(event.data);
      else {
        term.write(
          `\r\n\x1b[90m[Processus terminé, code ${event.exitCode}]\x1b[0m\r\n`,
        );
        sessionId.current = null;
        onExit(tabKey, typed && event.exitCode === 0);
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
    const keys = term.onKey(() => {
      typed = true;
    });
    // Redémarrage : écran effacé avant le nouveau shell.
    if (restarts > 0) term.reset();
    if (host.current?.offsetParent) current.fit.fit();
    client
      .call('terminal:create', {
        cols: term.cols,
        rows: term.rows,
        ...(shell === null ? {} : { shell }),
        ...(folderRef.current === null ? {} : { folder: folderRef.current }),
      })
      .then(
        (created) => {
          if (cancelled) {
            void client.call('terminal:close', { id: created.id });
            return;
          }
          id = created.id;
          sessionId.current = created.id;
          onSession(tabKey, created);
          for (const event of early) if (event.id === created.id) apply(event);
          fit();
        },
        (error: unknown) => {
          if (cancelled) return;
          term.write(
            `\x1b[31mTerminal indisponible : ${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`,
          );
          onExit(tabKey, false);
        },
      );
    return () => {
      cancelled = true;
      off();
      input.dispose();
      keys.dispose();
      if (id) void client.call('terminal:close', { id }).catch(() => undefined);
      sessionId.current = null;
    };
  }, [client, fit, restarts, shell, tabKey, onSession, onExit]);

  // Affiché : taille à jour et focus dans le terminal.
  useEffect(() => {
    if (!visible) return;
    fit();
    terminal.current?.term.focus();
  }, [visible, fit]);

  return (
    <div
      className="terminal-host"
      id={`terminal-${tabKey}`}
      role="tabpanel"
      aria-labelledby={`terminal-tab-${tabKey}`}
      hidden={!active}
      ref={host}
    />
  );
}
