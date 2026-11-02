/**
 * Parcours principaux dans l'application Electron réelle (§10.2).
 * Les boîtes de dialogue natives sont remplacées dans le processus principal
 * par des réponses fixes ; tout le reste (IPC, SQLite, rendu) est réel.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const electronPath = createRequire(import.meta.url)(
  'electron',
) as unknown as string;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nodal-e2e-'));
const userData = path.join(work, 'profil');
const workspaceFile = path.join(work, 'E2E.nodal');
const exportDir = path.join(work, 'exports');
const importedFile = path.join(work, 'Importé.nodal');

let app: ElectronApplication;
let page: Page;

async function launch(): Promise<void> {
  app = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: root,
    env: { ...process.env, NODAL_E2E_USER_DATA: userData },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
}

/** Réponses fixes des boîtes de dialogue natives (processus principal). */
async function stubDialogs(paths: {
  save?: string;
  open?: string;
}): Promise<void> {
  await app.evaluate(({ dialog }, stub) => {
    if (stub.save) {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: stub.save,
      })) as unknown as typeof dialog.showSaveDialog;
    }
    if (stub.open) {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [stub.open],
      })) as unknown as typeof dialog.showOpenDialog;
    }
  }, paths);
}

async function createNode(
  title: string,
  type: string,
  asChild = false,
  template = 'Aucun',
): Promise<void> {
  await page
    .getByRole('button', { name: asChild ? '+ Enfant' : '+ Racine' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Titre').fill(title);
  await dialog.getByLabel('Type').selectOption({ label: type });
  // Choisir un type propose son modèle de document : imposé ici.
  await dialog
    .getByLabel('Modèle de document')
    .selectOption({ label: template });
  await dialog.getByRole('button', { name: 'Créer' }).click();
  await page.getByRole('treeitem', { name: title }).waitFor();
}

async function addDocument(
  title: string,
  type: string,
  body: string,
  language?: string,
): Promise<void> {
  await page
    .locator('.documents')
    .getByRole('button', { name: '+ Document' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Nouveau document' });
  await dialog.getByLabel('Titre').fill(title);
  await dialog.getByLabel('Type de contenu').selectOption({ label: type });
  if (language) await dialog.getByLabel('Langage').selectOption(language);
  await dialog.getByRole('button', { name: 'Créer' }).click();
  await page.getByRole('tab', { name: title, selected: true }).waitFor();
  const editor = page.locator('.cm-content').first();
  await editor.click();
  // insertText : texte inséré tel quel (sans fermeture automatique des crochets).
  await page.keyboard.insertText(body);
}

async function waitSaved(): Promise<void> {
  await page.locator('.save-status', { hasText: 'Enregistré' }).waitFor();
}

beforeAll(async () => {
  fs.mkdirSync(exportDir, { recursive: true });
  await launch();
});

afterAll(async () => {
  await app?.close().catch(() => undefined);
  fs.rmSync(work, { recursive: true, force: true });
});

describe('parcours principaux', () => {
  it('crée un espace, une hiérarchie et une relation entre nœuds éloignés', async () => {
    await stubDialogs({ save: workspaceFile });
    await page.getByLabel('Nom de l’espace').fill('E2E');
    await page.getByRole('button', { name: 'Créer…' }).click();
    // Vue Graphe par défaut.
    await page.getByRole('button', { name: 'Graphe', pressed: true }).waitFor();

    await createNode('Plateforme', 'Composant');
    await createNode('API', 'Composant', true);
    await createNode('Base de données', 'Donnée');

    await page.getByRole('treeitem', { name: 'API' }).click();
    await page.getByRole('button', { name: '+ Relation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouvelle relation' });
    await dialog
      .getByLabel('Type de relation')
      .selectOption({ label: 'dépend de' });
    await dialog.getByLabel('Cible').selectOption({ label: 'Base de données' });
    await dialog.getByRole('button', { name: 'Créer la relation' }).click();
    await page
      .locator('.relation-list', { hasText: 'Base de données' })
      .waitFor();
    expect(fs.existsSync(workspaceFile)).toBe(true);
  });

  it('ajoute des documents Markdown, code et Mermaid avec rendu', async () => {
    await page.getByRole('button', { name: 'Documents' }).click();
    await addDocument(
      'Notes',
      'Markdown',
      '# Titre E2E\n\nVoir [[Base de données]].',
    );
    await page
      .locator('.markdown-preview h1', { hasText: 'Titre E2E' })
      .waitFor();
    await page
      .locator('.markdown-preview a.node-link', { hasText: 'Base de données' })
      .waitFor();

    await addDocument(
      'Requête',
      'Code',
      'SELECT * FROM commandes_secretes;',
      'sql',
    );
    await addDocument('Flux', 'Diagramme Mermaid', 'graph TD\n  A --> B');
    await page.locator('.mermaid-preview img').waitFor({ timeout: 30_000 });
    await waitSaved();
  });

  it('trouve une chaîne présente uniquement dans un bloc de code', async () => {
    await page
      .getByRole('combobox', { name: 'Rechercher dans l’espace' })
      .fill('commandes_secretes');
    await page.getByText('1 nœud').waitFor();
    await expect(
      page.getByRole('option').filter({ hasText: 'API' }).count(),
    ).resolves.toBe(1);
    await page.keyboard.press('Escape');
  });

  it('retrouve tout après fermeture et réouverture de l’application', async () => {
    await app.close();
    await launch();
    // Le dernier espace est rouvert au démarrage (préférence par défaut).
    await page.getByRole('treeitem', { name: 'Plateforme' }).waitFor();

    await page
      .getByRole('combobox', { name: 'Rechercher dans l’espace' })
      .fill('commandes_secretes');
    await page.getByRole('option').filter({ hasText: 'API' }).click();
    await page.getByRole('button', { name: 'Documents' }).click();
    for (const title of ['Notes', 'Requête', 'Flux']) {
      await page.getByRole('tab', { name: title }).waitFor();
    }
    await page
      .locator('.relation-list', { hasText: 'Base de données' })
      .waitFor();
  });

  it('crée un nœud avec le modèle de son type', async () => {
    await createNode('Déployer', 'Procédure', false, 'Procédure');
    await page.getByRole('button', { name: 'Documents' }).click();
    await page.getByRole('tab', { name: 'Procédure' }).waitFor();
    await page.getByText('Retour arrière').first().waitFor();
  });

  it('exporte puis réimporte l’espace sans perte', async () => {
    await stubDialogs({ open: exportDir });
    await page.getByText('Importer / exporter ▾').click();
    await page.getByRole('menuitem', { name: /Export portable/ }).click();
    await page.getByText(/Espace exporté dans/).waitFor();
    const [exported] = fs.readdirSync(exportDir);
    expect(exported).toBeDefined();

    await page.getByRole('button', { name: 'Fermer l’espace' }).click();
    await stubDialogs({
      open: path.join(exportDir, exported!),
      save: importedFile,
    });
    await page.getByRole('button', { name: 'Importer un export…' }).click();
    await page.getByText(/importé : 4 nœuds, 4 documents/).waitFor();
    await page.getByRole('treeitem', { name: 'Base de données' }).waitFor();
    expect(fs.existsSync(importedFile)).toBe(true);
  });
  it('capture rapide : la fenêtre dédiée range une note dans la boîte de réception', async () => {
    await page.keyboard.press('Control+Shift+P');
    await page
      .getByRole('combobox', { name: 'Aller à un nœud ou lancer une action' })
      .fill('capture rapide');
    const opened = app.waitForEvent('window');
    await page.keyboard.press('Enter');
    const capture = await opened;
    await capture.getByLabel('Titre').fill('Idée e2e');
    await capture.getByLabel('Note').fill('Note **rapide**');
    const closed = capture.waitForEvent('close');
    await capture.keyboard.press('Control+Enter');
    await closed;
    await page.getByRole('treeitem', { name: 'Boîte de réception' }).waitFor();
  });

  it('importe un dossier Markdown avec ses liens', async () => {
    const vault = path.join(work, 'Coffre');
    fs.mkdirSync(path.join(vault, 'Infra'), { recursive: true });
    fs.writeFileSync(
      path.join(vault, 'Infra', 'Redis.md'),
      ['---', 'type: component', '---', 'Voir [[Accueil]].'].join('\n'),
    );
    fs.writeFileSync(path.join(vault, 'Accueil.md'), '# Accueil');
    await stubDialogs({ open: vault });
    await page.getByText('Importer / exporter ▾').click();
    await page
      .getByRole('menuitem', { name: /Importer un dossier Markdown/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Importer « Coffre »' });
    await dialog.getByText(/2 notes/).waitFor();
    await dialog.getByRole('button', { name: 'Importer' }).click();
    await page.getByText(/« Coffre » importé : 4 nœuds/).waitFor();
    await page
      .getByRole('dialog', { name: 'Import terminé' })
      .getByRole('button', { name: 'Fermer', exact: true })
      .click();
    await page.getByRole('treeitem', { name: 'Coffre' }).waitFor();
    expect(
      fs.readdirSync(work).some((name) => name.includes('-avant-import-')),
    ).toBe(true);
  });

  it('donne la commande de l’assistant choisi (Gemini CLI)', async () => {
    await page.getByText('Importer / exporter ▾').click();
    await page
      .getByRole('menuitem', { name: /Connecter un assistant IA/ })
      .click();
    const dialog = page.getByRole('dialog', {
      name: 'Connecter un assistant IA (MCP)',
    });
    await dialog
      .getByLabel('Assistant', { exact: true })
      .selectOption({ label: 'Gemini CLI' });
    await dialog.getByText(/^gemini mcp add nodal node "/).waitFor();
    await dialog.getByText('GEMINI.md').waitFor();
    await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  });
});
