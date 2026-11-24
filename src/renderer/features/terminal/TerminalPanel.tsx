import { useCallback, useEffect, useState } from 'react';
import {
  TERMINAL_MAX_SESSIONS,
  type TerminalSession,
  type TerminalShell,
} from '../../../shared/terminal';
import { useClient } from '../../app/context';
import { MenuButton } from '../../components/MenuButton';
import { Resizer, usePaneSize } from '../../components/Resizer';
import { TerminalView } from './TerminalView';

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;

/** Shell des nouveaux terminaux, mémorisé pour ce poste. */
const SHELL_KEY = 'nodal.terminal.shell';

function savedShell(): string | null {
  try {
    return localStorage.getItem(SHELL_KEY) || null;
  } catch {
    return null;
  }
}

interface TerminalTab {
  key: number;
  /** Shell demandé ; `null` : celui par défaut. */
  shell: string | null;
  session: TerminalSession | null;
  /** Shell terminé de lui-même ou sur une erreur, ou qui n'a pas pu être lancé. */
  ended: boolean;
  restarts: number;
}

let nextKey = 1;
const newTab = (shell: string | null): TerminalTab => ({
  key: nextKey++,
  shell,
  session: null,
  ended: false,
  restarts: 0,
});

/** Noms des onglets, numérotés quand un shell est ouvert plusieurs fois. */
function tabNames(tabs: readonly TerminalTab[]): string[] {
  const counts = new Map<string, number>();
  return tabs.map(({ session }) => {
    const name = session?.shell ?? 'Terminal';
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    return count > 1 ? `${name} ${count}` : name;
  });
}

/** Onglet actif visible quand la barre d'onglets défile. */
const scrollToTab = (element: HTMLElement | null) =>
  element?.parentElement?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
  });

export interface TerminalPanelProps {
  /** Masqué : les sessions continuent (le panneau reste monté). */
  visible: boolean;
  onHide(): void;
  /** Dernier onglet fermé : le panneau peut être démonté. */
  onEmpty(): void;
  /** Raccourci d'ouverture / fermeture, affiché dans l'infobulle. */
  shortcut?: string;
}

/** Terminal intégré : un onglet par shell, type de shell au choix. */
export function TerminalPanel({
  visible,
  onHide,
  onEmpty,
  shortcut,
}: TerminalPanelProps) {
  const client = useClient();
  const { size, setSize, save } = usePaneSize('nodal.terminal.height');
  const [shells, setShells] = useState<TerminalShell[]>([]);
  const [preferred, setPreferred] = useState(savedShell);
  const [tabs, setTabs] = useState(() => [newTab(preferred)]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs.at(-1);
  const names = tabNames(tabs);
  const full = tabs.length >= TERMINAL_MAX_SESSIONS;

  useEffect(() => {
    let cancelled = false;
    client.call('terminal:listShells').then(
      (list) => {
        if (!cancelled) setShells(list);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  const empty = tabs.length === 0;
  useEffect(() => {
    if (empty) onEmpty();
  }, [empty, onEmpty]);

  const update = useCallback(
    (key: number, change: Partial<TerminalTab>) =>
      setTabs((list) =>
        list.map((tab) => (tab.key === key ? { ...tab, ...change } : tab)),
      ),
    [],
  );
  const close = useCallback(
    (key: number) => setTabs((list) => list.filter((tab) => tab.key !== key)),
    [],
  );
  const onSession = useCallback(
    (key: number, session: TerminalSession) => update(key, { session }),
    [update],
  );
  // `exit` ferme l'onglet ; sinon il reste, pour être lu.
  const onExit = useCallback(
    (key: number, asked: boolean) =>
      asked ? close(key) : update(key, { ended: true }),
    [close, update],
  );

  const open = (shell: string | null) => {
    if (full) return;
    const tab = newTab(shell);
    setTabs((list) => [...list, tab]);
    setActiveKey(tab.key);
  };
  const makeDefault = (shell: string) => {
    setPreferred(shell);
    try {
      localStorage.setItem(SHELL_KEY, shell);
    } catch {
      // Choix non mémorisé.
    }
  };

  const defaultShell = shells.find(({ id }) => id === preferred) ?? shells[0];
  const current = active?.session ?? null;
  const menu = [
    ...shells.map((shell) => ({
      label: shell.name,
      shortcut: shell.id === defaultShell?.id ? 'par défaut' : undefined,
      disabled: full,
      onSelect: () => open(shell.id),
    })),
    ...(current && current.shellId !== defaultShell?.id
      ? [
          {
            label: `Utiliser « ${current.shell} » par défaut`,
            separator: true,
            onSelect: () => makeDefault(current.shellId),
          },
        ]
      : []),
  ];

  const onTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step =
      event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setActiveKey(tabs[(index + step + tabs.length) % tabs.length]!.key);
  };

  const height = size ?? DEFAULT_HEIGHT;
  return (
    <section
      className="terminal-panel"
      aria-label="Terminal"
      hidden={!visible}
      style={{ height }}
    >
      <Resizer
        label="Redimensionner le terminal"
        from="bottom"
        className="terminal-resizer"
        value={height}
        min={MIN_HEIGHT}
        max={() => Math.round(window.innerHeight * 0.75)}
        onResize={setSize}
        onSave={save}
      />
      <header className="terminal-header">
        <div
          className="terminal-tabs"
          role="tablist"
          aria-label="Terminaux ouverts"
        >
          {tabs.map((tab, index) => (
            <span
              key={tab.key}
              role="presentation"
              className={
                tab === active ? 'terminal-tab selected' : 'terminal-tab'
              }
              // Clic du milieu : fermer, comme dans un navigateur.
              onAuxClick={(event) => {
                if (event.button === 1) close(tab.key);
              }}
            >
              <button
                type="button"
                role="tab"
                id={`terminal-tab-${tab.key}`}
                aria-selected={tab === active}
                aria-controls={`terminal-${tab.key}`}
                tabIndex={tab === active ? 0 : -1}
                ref={tab === active ? scrollToTab : undefined}
                title={tab.session?.cwd}
                onClick={() => setActiveKey(tab.key)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {names[index]}
                {tab.ended && ' (terminé)'}
              </button>
              <button
                type="button"
                className="terminal-tab-close"
                aria-label={`Fermer ${names[index]}`}
                title="Fermer ce terminal (arrête son shell)"
                onClick={() => close(tab.key)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <button
          type="button"
          className="secondary icon-button"
          aria-label="Nouveau terminal"
          title={
            full
              ? `${TERMINAL_MAX_SESSIONS} terminaux au plus`
              : `Nouveau terminal${defaultShell ? ` (${defaultShell.name})` : ''}`
          }
          disabled={full}
          onClick={() => open(preferred)}
        >
          +
        </button>
        <MenuButton
          label="Type de terminal"
          title="Choisir le type de terminal"
          items={menu}
          disabled={menu.length === 0}
          caret={false}
        >
          ▾
        </MenuButton>
        <span className="toolbar-spacer" />
        {current && (
          <span className="muted terminal-cwd" title={current.cwd}>
            {current.cwd}
          </span>
        )}
        {active && (
          <button
            type="button"
            className="secondary"
            title={
              active.ended
                ? undefined
                : 'Arrêter le shell et en lancer un nouveau'
            }
            onClick={() =>
              update(active.key, {
                restarts: active.restarts + 1,
                ended: false,
              })
            }
          >
            {active.ended ? 'Relancer' : 'Redémarrer'}
          </button>
        )}
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
      {tabs.map((tab) => (
        <TerminalView
          key={tab.key}
          tabKey={tab.key}
          shell={tab.shell}
          active={tab === active}
          visible={visible && tab === active}
          restarts={tab.restarts}
          onSession={onSession}
          onExit={onExit}
        />
      ))}
    </section>
  );
}
