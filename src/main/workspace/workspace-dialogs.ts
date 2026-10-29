import { dialog, type BrowserWindow } from 'electron';
import { NODAL_FILE_EXTENSION } from '../../shared/domain';

const NODAL_FILTERS = [
  { name: 'Espace Nodal', extensions: [NODAL_FILE_EXTENSION] },
];

/** Caractères interdits dans un nom de fichier Windows. */
function toFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'Espace';
}

/**
 * Boîtes de dialogue de fichiers. Le chemin est toujours choisi ici, côté main :
 * le renderer ne transmet jamais de chemin.
 */
export interface WorkspaceDialogs {
  /** Retourne `null` si l'utilisateur annule. */
  pickNewWorkspacePath(suggestedName: string): Promise<string | null>;
  /** Retourne `null` si l'utilisateur annule. */
  pickExistingWorkspacePath(): Promise<string | null>;
}

export function createWorkspaceDialogs(
  getParentWindow: () => BrowserWindow | null,
): WorkspaceDialogs {
  return {
    async pickNewWorkspacePath(suggestedName) {
      const options: Electron.SaveDialogOptions = {
        title: 'Créer un espace Nodal',
        defaultPath: `${toFileName(suggestedName)}.${NODAL_FILE_EXTENSION}`,
        filters: NODAL_FILTERS,
        // Un fichier existant n'est jamais écrasé : le service refusera la création.
        properties: ['createDirectory'],
      };
      const parent = getParentWindow();
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },

    async pickExistingWorkspacePath() {
      const options: Electron.OpenDialogOptions = {
        title: 'Ouvrir un espace Nodal',
        filters: NODAL_FILTERS,
        properties: ['openFile'],
      };
      const parent = getParentWindow();
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  };
}
