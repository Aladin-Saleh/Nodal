import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppInfo, WorkspaceInfo } from '../../shared/ipc-contract';
import type { RecentWorkspace } from '../../shared/model';
import { WelcomeScreen } from '../features/workspace/WelcomeScreen';
import { WorkspaceScreen } from '../features/workspace/WorkspaceScreen';
import { describeError, type NodalClient } from '../services/nodal-client';
import { SaveTracker } from '../services/save-tracker';
import { ServicesProvider } from './context';
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
    ])
      .then(([info, current]) => {
        if (cancelled) return;
        setAppInfo(info);
        // Ne pas écraser un espace ouvert par l'utilisateur entre-temps.
        setWorkspace((previous) => previous ?? current);
      })
      .catch((err: unknown) => {
        if (!cancelled) reportError(err);
      });
    void refreshRecent();
    return () => {
      cancelled = true;
    };
  }, [client, reportError, refreshRecent]);

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
              onOpen={() => void openWith(() => client.call('workspace:open'))}
              onImport={() => void handleImport()}
              onOpenRecent={(id) =>
                void openWith(() => client.call('workspace:openRecent', { id }))
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
        <StatusBar appInfo={appInfo} workspace={workspace} />
      </div>
    </ServicesProvider>
  );
}
