/**
 * Capture rapide (raccourci global) : range un titre et une note dans la
 * boîte de réception de l'espace ouvert, ou à défaut du dernier espace
 * récent — ouvert le temps de l'écriture, sans l'afficher. Indépendant
 * d'Electron : testable sous Node.
 */
import { randomUUID } from 'node:crypto';
import { NodalError } from '../../shared/errors';
import type {
  CaptureInput,
  CaptureResult,
  CaptureTarget,
} from '../../shared/quick-capture';
import { closeNodalDatabase, openNodalDatabase } from '../database/connection';
import type { ServiceContext } from '../knowledge/context';
import { captureToInbox } from '../knowledge/inbox-service';
import type { RecentWorkspacesStore } from '../workspace/recent-workspaces';
import { listWorkspaces } from '../workspace/workspace-repository';
import type { WorkspaceService } from '../workspace/workspace-service';

export interface QuickCaptureDependencies {
  workspaces: WorkspaceService;
  recent: Pick<RecentWorkspacesStore, 'list'>;
  now?: () => Date;
}

export class QuickCaptureService {
  private readonly now: () => Date;

  constructor(private readonly deps: QuickCaptureDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Espace qui recevra la capture ; `null` si aucun n'est disponible. */
  target(): CaptureTarget | null {
    const current = this.deps.workspaces.getCurrent();
    if (current) return { workspaceName: current.name, open: true };
    const last = this.lastRecent();
    return last ? { workspaceName: last.name, open: false } : null;
  }

  /**
   * Enregistre la capture. `open` : l'espace est celui de la fenêtre
   * principale, qui doit recharger ce qu'elle affiche.
   */
  submit(input: CaptureInput): CaptureResult & { open: boolean } {
    const current = this.deps.workspaces.getCurrent();
    if (current) {
      const { nodeId } = captureToInbox(
        this.deps.workspaces.getContext(),
        input,
      );
      return { workspaceName: current.name, nodeId, open: true };
    }
    const last = this.lastRecent();
    if (!last) {
      throw new NodalError(
        'NO_WORKSPACE_OPEN',
        'Aucun espace récent : ouvrez ou créez un espace dans Nodal.',
      );
    }
    // Connexion le temps de l'écriture (même accès concurrent que le
    // serveur MCP) ; la fenêtre principale reste sur l'accueil.
    const db = openNodalDatabase(last.filePath);
    try {
      const [workspace] = listWorkspaces(db);
      if (!workspace) {
        throw new NodalError(
          'INVALID_WORKSPACE_FILE',
          'Fichier Nodal invalide.',
        );
      }
      const ctx: ServiceContext = {
        db,
        workspaceId: workspace.id,
        now: () => this.now().toISOString(),
        newId: randomUUID,
      };
      const { nodeId } = captureToInbox(ctx, input);
      return { workspaceName: workspace.name, nodeId, open: false };
    } finally {
      closeNodalDatabase(db);
    }
  }

  private lastRecent() {
    return this.deps.recent.list().find((entry) => entry.exists) ?? null;
  }
}
