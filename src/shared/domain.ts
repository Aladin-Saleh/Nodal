/**
 * Constantes du modèle de données partagées entre main et renderer (§5, §13).
 * Toute valeur ajoutée ici doit aussi être reflétée dans les contraintes CHECK
 * des migrations SQLite.
 */

/** Les six types de nœuds, fixes en V1 (§5.2, §13). */
export const NODE_TYPES = [
  'concept',
  'component',
  'data',
  'procedure',
  'resource',
  'generic',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

/** Un document a un seul type de contenu (§13). */
export const CONTENT_TYPES = [
  'markdown',
  'text',
  'json',
  'code',
  'mermaid',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Types de relations insérés à la création d'un espace (§5.3). */
export const DEFAULT_RELATION_TYPES = [
  'dépend de',
  'utilise',
  'implémente',
  'alimente',
  'consomme',
  'décrit',
  'remplace',
  'est lié à',
] as const;

/** Extension du fichier projet (§8). */
export const NODAL_FILE_EXTENSION = 'nodal';

export const WORKSPACE_NAME_MAX_LENGTH = 200;

/** Libellés affichés des types de nœuds (§5.2). */
export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  concept: 'Concept',
  component: 'Composant',
  data: 'Donnée',
  procedure: 'Procédure',
  resource: 'Ressource',
  generic: 'Générique',
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  markdown: 'Markdown',
  text: 'Texte brut',
  json: 'JSON',
  code: 'Code',
  mermaid: 'Diagramme Mermaid',
};

/** Langages proposés pour les documents de code (§6.4). */
export const CODE_LANGUAGES = [
  'java',
  'javascript',
  'typescript',
  'python',
  'sql',
  'go',
  'json',
  'yaml',
  'bash',
  'c',
  'cpp',
  'other',
] as const;

export const TITLE_MAX_LENGTH = 300;
export const SUMMARY_MAX_LENGTH = 2000;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const TAG_NAME_MAX_LENGTH = 60;
/** Taille maximale d'un corps de document (en caractères). */
export const DOCUMENT_BODY_MAX_LENGTH = 5_000_000;

/** Taille maximale par pièce jointe (§5.1, §8) : défaut et bornes réglables. */
export const ATTACHMENT_MAX_SIZE_DEFAULT_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_MAX_SIZE_LIMIT_BYTES = 200 * 1024 * 1024;
export const RELATION_TYPE_NAME_MAX_LENGTH = 60;
export const EDGE_LABEL_MAX_LENGTH = 120;
