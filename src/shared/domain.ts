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
