import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TERMINAL_MAX_SESSIONS,
  type TerminalSession,
  type TerminalShell,
} from '../../../shared/terminal';
import type { CodeRootInfo } from '../../../shared/code-anchors';
import { useClient, useRunner } from '../../app/context';
import { MenuButton } from '../../components/MenuButton';
import { Resizer, usePaneSize } from '../../components/Resizer';
import { repoName } from '../workspace/ReposMenu';
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
  /** Dossier de code choisi ; `null` : celui par défaut (le premier). */
  folder: string | null;
  session: TerminalSession | null;
  /** Shell terminé de lui-même ou sur une erreur, ou qui n'a pas pu être lancé. */
  ended: boolean;
  restarts: number;
}

let nextKey = 1;
const newTab = (
  shell: string | null,
  folder: string | null = null,
): TerminalTab => ({
  key: nextKey++,
  shell,
  folder,
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

/** Terminal demandé dans un dossier de code ; `id` change à chaque demande. */
export interface TerminalRequest {
  folder: string;
  id: number;
}

export interface TerminalPanelProps {
  /** Masqué : les sessions continuent (le panneau reste monté). */
  visible: boolean;
  onHide(): void;
  /** Dernier onglet fermé : le panneau peut être démonté. */
  onEmpty(): void;
  /**
   * Nouveau terminal dans ce dossier (menu « Repos ») ; 8 terminaux déjà
   * ouverts : celui affiché s'y déplace.
   */
  request?: TerminalRequest | null;
  /** Raccourci d'ouverture / fermeture, affiché dans l'infobulle. */
  shortcut?: string;
}

/** Terminal intégré : un onglet par shell, type de shell au choix. */
export function TerminalPanel({
  visible,
  onHide,
  onEmpty,
  request = null,
  shortcut,
}: TerminalPanelProps) {
  const client = useClient();
  const run = useRunner();
  const { size, setSize, save } = usePaneSize('nodal.terminal.height');
  const [shells, setShells] = useState<TerminalShell[]>([]);
  /** Dossiers de code de l'espace où l'on peut se placer. */
  const [folders, setFolders] = useState<string[]>([]);
  const [preferred, setPreferred] = useState(savedShell);
  // Monté par une demande : le premier terminal s'ouvre dans son dossier.
  const [tabs, setTabs] = useState(() => [
    newTab(preferred, request?.folder ?? null),
  ]);
  const handled = useRef(request?.id ?? 0);
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

  const loadFolders = useCallback(
    () =>
      client.call('code:getRoots').then(
        (roots: CodeRootInfo[]) =>
          setFolders(
            roots.filter((root) => root.exists).map((root) => root.path),
          ),
        () => undefined,
      ),
    [client],
  );
  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

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

  const open = (shell: string | null, folder = active?.folder ?? null) => {
    if (full) return;
    // Par défaut, même dossier que le terminal affiché.
    const tab = newTab(shell, folder);
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

  /** Déplace le terminal affiché (ou le prochain shell s'il est terminé). */
  const moveTo = async (folder: string) => {
    if (!active) return;
    const { key, session, ended } = active;
    if (session && !ended) {
      const moved = await run(() =>
        client.call('terminal:changeDirectory', { id: session.id, folder }),
      );
      if (moved === undefined) return;
    }
    update(key, { folder });
    document
      .querySelector<HTMLElement>(`#terminal-${key} .xterm-helper-textarea`)
      ?.focus();
  };

  // Demande du menu « Repos » : traitée une fois.
  const openRef = useRef(open);
  const moveRef = useRef(moveTo);
  useEffect(() => {
    openRef.current = open;
    moveRef.current = moveTo;
  });
  useEffect(() => {
    if (!request || request.id === handled.current) return;
    handled.current = request.id;
    if (full) void moveRef.current(request.folder);
    else openRef.current(preferred, request.folder);
  }, [request, full, preferred]);

  const defaultShell = shells.find(({ id }) => id === preferred) ?? shells[0];
  const current = active?.session ?? null;
  /** Dernier dossier choisi, sinon dossier de départ du shell. */
  const where = active?.folder ?? current?.cwd ?? '';
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
        {active && folders.length > 1 ? (
          <select
            className="terminal-folder"
            aria-label="Dossier du terminal"
            title={`${where || 'Dossier du terminal'} (se placer dans un autre dossier de code)`}
            value={where}
            onFocus={() => void loadFolders()}
            onChange={(event) => void moveTo(event.target.value)}
          >
            {/* Dossier de départ hors des dossiers de code (dossier du .nodal). */}
            {!folders.includes(where) && (
              <option value={where} disabled>
                {where ? repoName(where) : 'Dossier…'}
              </option>
            )}
            {folders.map((folder) => (
              <option key={folder} value={folder} title={folder}>
                {repoName(folder)}
              </option>
            ))}
          </select>
        ) : (
          current && (
            <span className="muted terminal-cwd" title={current.cwd}>
              {current.cwd}
            </span>
          )
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
          folder={tab.folder}
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
