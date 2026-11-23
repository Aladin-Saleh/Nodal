import {
  app,
  dialog,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';

export const AUTHOR = {
  name: 'Aladin SALEH',
  email: 'aladin8857@gmail.com',
  brand: "Aladinvention's Software",
} as const;

/** Fenêtre « À propos » : rôle de l'application, version, auteur. */
export async function showAboutDialog(
  parent: BrowserWindow | null,
): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    title: 'À propos de Nodal',
    message: `Nodal ${app.getVersion()}`,
    detail: [
      'Base de connaissances techniques sous forme de graphe : nœuds ' +
        'hiérarchiques, documents typés (Markdown, code, Mermaid…) et ' +
        'relations nommées, enregistrés localement dans un fichier .nodal. ' +
        'Un serveur MCP intégré la met à disposition des assistants IA.',
      '',
      `Auteur : ${AUTHOR.name}`,
      `Contact : ${AUTHOR.email}`,
      '',
      `${AUTHOR.brand} — © ${new Date().getFullYear()}`,
      `Electron ${process.versions.electron} · Node.js ${process.versions.node}`,
    ].join('\n'),
    buttons: ['Fermer', "Écrire à l'auteur"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  if (response === 1) void shell.openExternal(`mailto:${AUTHOR.email}`);
}

/**
 * Barre de menus de la fenêtre principale : menus standard d'Electron
 * (mêmes raccourcis que le menu par défaut) et un menu Help avec « À propos ».
 */
export function buildAppMenu(getWindow: () => BrowserWindow | null): Menu {
  const template: MenuItemConstructorOptions[] = [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'À propos de Nodal',
          click: () => void showAboutDialog(getWindow()),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
