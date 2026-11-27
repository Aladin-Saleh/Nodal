import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, WorkspaceInfo } from '../../shared/ipc-contract';
import type { RecentWorkspace } from '../../shared/model';
import type { NodeLinkTarget } from '../../shared/node-links';
import type { NodeRequest } from '../features/workspace/WorkspaceScreen';
import { WelcomeScreen } from '../features/workspace/WelcomeScreen';
import { WorkspaceScreen } from '../features/workspace/WorkspaceScreen';
import { describeError, type NodalClient } from '../services/nodal-client';
import { SaveTracker } from '../services/save-tracker';
import { PreferencesDialog } from '../features/preferences/PreferencesDialog';
import { ServicesProvider } from './context';
import { PreferencesProvider } from './preferences';
import { ErrorMessage } from './ErrorMessage';
import { StatusBar } from './StatusBar';
import { ImportReportDialog } from '../features/workspace/PortabilityDialogs';

export interface AppProps {
  client: NodalClient;
}

export function App({ client }: AppProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const [notice, setNotice] = useState<{
    kind: 'error' | 'info';
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  /** Nœud à afficher, demandé par un lien nodal:// (`nonce` : nouvelle demande). */
  const [nodeRequest, setNodeRequest] = useState<NodeRequest | null>(null);
  const showLinkedNode = useCallback(
    (nodeId: string) =>
      setNodeRequest((previous) => ({
        nodeId,
        nonce: (previous?.nonce ?? 0) + 1,
      })),
    [],
  );

  // Ctrl+, : préférences, depuis n'importe quel écran.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ',') {
        event.preventDefault();
        setPreferencesOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const tracker = useMemo(
    () =>
      new SaveTracker((unsaved) => {
        client.call('app:setUnsavedChanges', unsaved).catch(() => undefined);
      }),
    [client],
  );
  const reportError = useCallback(
    (err: unknown) => setNotice({ kind: 'error', message: describeError(err) }),
    [],
  );
  const reportInfo = useCallback(
    (message: string) => setNotice({ kind: 'info', message }),
    [],
  );

  const refreshRecent = useCallback(
    () => client.call('workspace:listRecent').then(setRecent, reportError),
    [client, reportError],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.call('app:getInfo'),
      client.call('workspace:getCurrent'),
      client.call('preferences:get'),
      client.call('workspace:listRecent'),
      // Nodal lancé par un lien nodal:// : son espace plutôt que le dernier.
      client.call('link:takePending').catch(() => null),
    ])
      .then(async ([info, current, preferences, recentList, link]) => {
        if (cancelled) return;
        setAppInfo(info);
        const last = recentList[0];
        const toOpen =
          link?.kind === 'node' && link.recentId
            ? link.recentId
            : !current && preferences.reopenLastWorkspace && last?.exists
              ? last.id
              : null;
        const reopened = toOpen
          ? await client
              .call('workspace:openRecent', { id: toOpen })
              // Échec silencieux : l'accueil reste affiché.
              .catch(() => null)
          : null;
        if (cancelled) return;
        // Ne pas écraser un espace ouvert par l'utilisateur entre-temps.
        setWorkspace((previous) =>
          link?.kind === 'node' && link.recentId && reopened
            ? reopened
            : (previous ?? current ?? reopened),
        );
        if (link?.kind === 'node') showLinkedNode(link.nodeId);
        else if (link) setNotice({ kind: 'error', message: link.message });
      })
      .catch((err: unknown) => {
        if (!cancelled) reportError(err);
      });
    void refreshRecent();
    return () => {
      cancelled = true;
    };
  }, [client, reportError, refreshRecent, showLinkedNode]);

  // Fermeture de la fenêtre : écrire ce qui est en attente (§6.1).
  useEffect(
    () =>
      client.onFlushRequest(() => {
        void tracker.flushAll();
      }),
    [client, tracker],
  );

  /** Exécute une action d'espace en affichant l'erreur éventuelle. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  /** Avant de quitter l'espace courant : tout enregistrer, sinon s'arrêter. */
  const leaveWorkspace = async () => {
    if (!(await tracker.flushAll())) {
      throw new Error('Des modifications n’ont pas pu être enregistrées.');
    }
  };

  const openWith = (open: () => Promise<WorkspaceInfo | null>) =>
    run(async () => {
      const opened = await open();
      if (opened) setWorkspace(opened);
      void refreshRecent();
    });

  const handleImport = () =>
    run(async () => {
      const result = await client.call('workspace:import');
      if (!result) return;
      if (result.kind === 'invalid') {
        setImportErrors(result.errors);
        return;
      }
      setWorkspace(result.workspace);
      reportInfo(
        `Espace « ${result.workspace.name} » importé : ${result.nodeCount} nœuds, ${result.documentCount} documents, ${result.attachmentCount} pièces jointes.`,
      );
      void refreshRecent();
    });

  /** Lien nodal:// reçu pendant que Nodal est ouvert. */
  const openLink = async (target: NodeLinkTarget) => {
    if (target.kind === 'missing') {
      setNotice({ kind: 'error', message: target.message });
      return;
    }
    const recentId = target.recentId;
    if (recentId) {
      await run(async () => {
        await leaveWorkspace();
        const opened = await client.call('workspace:openRecent', {
          id: recentId,
        });
        setWorkspace(opened);
        void refreshRecent();
      });
    }
    showLinkedNode(target.nodeId);
  };
  const openLinkRef = useRef(openLink);
  useEffect(() => {
    openLinkRef.current = openLink;
  });
  useEffect(
    () =>
      client.onNodeLink(() => {
        void client
          .call('link:takePending')
          .then((target) => target && openLinkRef.current(target), reportError);
      }),
    [client, reportError],
  );

  const handleClose = () =>
    run(async () => {
      await leaveWorkspace();
      await client.call('workspace:close');
      setWorkspace(null);
      void refreshRecent();
    });

  return (
    <ServicesProvider
      client={client}
      tracker={tracker}
      reportError={reportError}
      reportInfo={reportInfo}
    >
      <PreferencesProvider client={client} onError={reportError}>
        <div className="app">
          {notice && (
            <ErrorMessage
              message={notice.message}
              kind={notice.kind}
              onDismiss={() => setNotice(null)}
            />
          )}
          {workspace ? (
            <WorkspaceScreen
              key={workspace.id}
              workspace={workspace}
              onWorkspaceChanged={setWorkspace}
              onClose={() => void handleClose()}
              onOpenPreferences={() => setPreferencesOpen(true)}
              nodeRequest={nodeRequest}
              onNodeRequestDone={() => setNodeRequest(null)}
              onDeleted={() => {
                setWorkspace(null);
                void refreshRecent();
              }}
            />
          ) : (
            <main className="app-content">
              <WelcomeScreen
                busy={busy}
                recent={recent}
                onCreate={(name) =>
                  void openWith(() => client.call('workspace:create', { name }))
                }
                onOpen={() =>
                  void openWith(() => client.call('workspace:open'))
                }
                onImport={() => void handleImport()}
                onOpenRecent={(id) =>
                  void openWith(() =>
                    client.call('workspace:openRecent', { id }),
                  )
                }
                onRemoveRecent={(id) =>
                  void client
                    .call('workspace:removeRecent', { id })
                    .then(refreshRecent, reportError)
                }
              />
            </main>
          )}
          {importErrors && (
            <ImportReportDialog
              errors={importErrors}
              onClose={() => setImportErrors(null)}
            />
          )}
          {preferencesOpen && (
            <PreferencesDialog onClose={() => setPreferencesOpen(false)} />
          )}
          <StatusBar
            appInfo={appInfo}
            workspace={workspace}
            onOpenPreferences={() => setPreferencesOpen(true)}
          />
        </div>
      </PreferencesProvider>
    </ServicesProvider>
  );
}
