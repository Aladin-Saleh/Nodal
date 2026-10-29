import { useCallback, useEffect, useState } from 'react';
import type { AppInfo, WorkspaceInfo } from '../../shared/ipc-contract';
import { describeError, type NodalClient } from '../services/nodal-client';
import { ErrorMessage } from './ErrorMessage';
import { StatusBar } from './StatusBar';
import { WelcomeScreen } from './WelcomeScreen';
import { WorkspaceView } from './WorkspaceView';

export interface AppProps {
  client: NodalClient;
}

export function App({ client }: AppProps) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([client.getAppInfo(), client.getCurrentWorkspace()])
      .then(([info, current]) => {
        if (cancelled) return;
        setAppInfo(info);
        // Ne pas écraser un espace ouvert par l'utilisateur entre-temps.
        setWorkspace((previous) => previous ?? current);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  /** Exécute une action en affichant l'erreur éventuelle. */
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCreate = (name: string) =>
    run(async () => {
      const created = await client.createWorkspace({ name });
      if (created) setWorkspace(created);
    });

  const handleOpen = () =>
    run(async () => {
      const opened = await client.openWorkspace();
      if (opened) setWorkspace(opened);
    });

  const handleClose = () =>
    run(async () => {
      await client.closeWorkspace();
      setWorkspace(null);
    });

  return (
    <div className="app">
      <main className="app-content">
        {error && (
          <ErrorMessage message={error} onDismiss={() => setError(null)} />
        )}
        {workspace ? (
          <WorkspaceView
            workspace={workspace}
            busy={busy}
            onClose={handleClose}
          />
        ) : (
          <WelcomeScreen
            busy={busy}
            onCreate={handleCreate}
            onOpen={handleOpen}
          />
        )}
      </main>
      <StatusBar appInfo={appInfo} workspace={workspace} />
    </div>
  );
}
