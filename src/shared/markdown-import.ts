/**
 * Import d'un dossier Markdown ou d'un coffre Obsidian : types échangés entre
 * main et renderer, et limites. Le renderer ne voit jamais de chemin absolu.
 */

/** Au-delà, l'import est refusé : mieux vaut importer un sous-dossier. */
export const MARKDOWN_IMPORT_MAX_NOTES = 5_000;
/** Profondeur maximale des dossiers parcourus. */
export const MARKDOWN_IMPORT_MAX_DEPTH = 32;
/** Lignes détaillées au plus dans l'aperçu et le rapport (le reste est compté). */
export const MARKDOWN_IMPORT_LIST_LIMIT = 50;

/** Élément ignoré, avec sa raison ; chemin relatif au dossier importé. */
export interface SkippedEntry {
  path: string;
  reason: string;
}

/** Lien qui ne désigne aucune note du dossier ni aucun nœud de l'espace. */
export interface UnresolvedLink {
  /** Note qui contient le lien (chemin relatif). */
  note: string;
  target: string;
}

export interface MarkdownImportPreview {
  /** Identifiant du plan gardé par le main, à repasser pour importer. */
  token: string;
  folderName: string;
  folderCount: number;
  noteCount: number;
  attachmentCount: number;
  /** Liens vers une note du dossier ou un nœud existant. */
  linkCount: number;
  unresolvedCount: number;
  unresolved: UnresolvedLink[];
  skippedCount: number;
  skipped: SkippedEntry[];
  /** Notes dont le front-matter donne un type, des tags ou un résumé. */
  frontMatterCount: number;
}

export interface MarkdownImportReport {
  /** Nœud racine créé pour le dossier importé. */
  rootId: string;
  nodeCount: number;
  documentCount: number;
  attachmentCount: number;
  /** Relations « est lié à » créées par les liens. */
  relationCount: number;
  unresolvedCount: number;
  unresolved: UnresolvedLink[];
  skippedCount: number;
  skipped: SkippedEntry[];
  /** Copie de l'espace faite avant l'import. */
  backupPath: string;
}
