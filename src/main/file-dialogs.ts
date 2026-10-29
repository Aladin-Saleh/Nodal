import { dialog, type BrowserWindow } from 'electron';
import { NODAL_FILE_EXTENSION } from '../shared/domain';

const NODAL_FILTERS = [
  { name: 'Espace Nodal', extensions: [NODAL_FILE_EXTENSION] },
];

/** Caractères interdits dans un nom de fichier Windows. */
function toFileName(name: string, fallback: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, '').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Boîtes de dialogue de fichiers. Les chemins sont toujours choisis ici, côté
 * main : le renderer ne transmet jamais de chemin.
 */
export interface FileDialogs {
  /** Retourne `null` si l'utilisateur annule. */
  pickNewWorkspacePath(suggestedName: string): Promise<string | null>;
  /** Retourne `null` si l'utilisateur annule. */
  pickExistingWorkspacePath(): Promise<string | null>;
  /** Fichiers à joindre ; liste vide si l'utilisateur annule. */
  pickAttachmentPaths(): Promise<string[]>;
  /** Destination d'une copie de pièce jointe ; `null` si annulé. */
  pickAttachmentSavePath(fileName: string): Promise<string | null>;
  /** Dossier dans lequel créer un export ; `null` si annulé. */
  pickExportParentDirectory(): Promise<string | null>;
  /** Dossier d'export à importer ; `null` si annulé. */
  pickImportFolder(): Promise<string | null>;
  /** Emplacement d'un fichier .nodal (nouvel espace importé, sauvegarde). */
  pickNodalSavePath(
    title: string,
    suggestedName: string,
  ): Promise<string | null>;
  /** Demande de confirmation native ; `true` si l'utilisateur confirme. */
  confirm(options: {
    message: string;
    detail: string;
    confirmLabel: string;
  }): Promise<boolean>;
}

export function createFileDialogs(
  getParentWindow: () => BrowserWindow | null,
): FileDialogs {
  const save = (options: Electron.SaveDialogOptions) => {
    const parent = getParentWindow();
    return parent
      ? dialog.showSaveDialog(parent, options)
      : dialog.showSaveDialog(options);
  };
  const open = (options: Electron.OpenDialogOptions) => {
    const parent = getParentWindow();
    return parent
      ? dialog.showOpenDialog(parent, options)
      : dialog.showOpenDialog(options);
  };

  return {
    async pickNewWorkspacePath(suggestedName) {
      const result = await save({
        title: 'Créer un espace Nodal',
        defaultPath: `${toFileName(suggestedName, 'Espace')}.${NODAL_FILE_EXTENSION}`,
        filters: NODAL_FILTERS,
        // Un fichier existant n'est jamais écrasé : le service refusera la création.
        properties: ['createDirectory'],
      });
      return result.canceled || !result.filePath ? null : result.filePath;
    },

    async pickExistingWorkspacePath() {
      const result = await open({
        title: 'Ouvrir un espace Nodal',
        filters: NODAL_FILTERS,
        properties: ['openFile'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },

    async pickAttachmentPaths() {
      const result = await open({
        title: 'Joindre des fichiers',
        properties: ['openFile', 'multiSelections'],
      });
      return result.canceled ? [] : result.filePaths;
    },

    async pickAttachmentSavePath(fileName) {
      const result = await save({
        title: 'Enregistrer la pièce jointe',
        defaultPath: toFileName(fileName, 'piece-jointe'),
      });
      return result.canceled || !result.filePath ? null : result.filePath;
    },

    async pickExportParentDirectory() {
      const result = await open({
        title: 'Choisir le dossier où créer l’export',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },

    async pickImportFolder() {
      const result = await open({
        title: 'Choisir le dossier d’export Nodal à importer',
        properties: ['openDirectory'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },

    async pickNodalSavePath(title, suggestedName) {
      const result = await save({
        title,
        defaultPath: `${toFileName(suggestedName, 'Espace')}.${NODAL_FILE_EXTENSION}`,
        filters: NODAL_FILTERS,
        properties: ['createDirectory'],
      });
      return result.canceled || !result.filePath ? null : result.filePath;
    },

    async confirm({ message, detail, confirmLabel }) {
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        buttons: [confirmLabel, 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: 'Nodal',
        message,
        detail,
      };
      const parent = getParentWindow();
      const result = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      return result.response === 0;
    },
  };
}
