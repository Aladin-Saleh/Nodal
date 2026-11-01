/**
 * Modèles de documents par type de nœud (Markdown). Proposés à la création
 * d'un nœud ou d'un document, modifiables par espace. Logique pure.
 */
import { z } from 'zod';
import { NODE_TYPES, TITLE_MAX_LENGTH, type NodeType } from './domain';

export const TEMPLATE_NAME_MAX_LENGTH = 100;
export const TEMPLATE_BODY_MAX_LENGTH = 20_000;
export const TEMPLATES_MAX_COUNT = 50;

export interface DocumentTemplate {
  /** Identifiant stable dans l'espace (choisi par Nodal). */
  id: string;
  /** Nom affiché dans les listes (« Procédure », « Décision (ADR) »). */
  name: string;
  /** Type de nœud pour lequel le modèle est proposé en premier. */
  nodeType: NodeType;
  /** Titre du document créé. */
  documentTitle: string;
  body: string;
}

export interface TemplateList {
  templates: DocumentTemplate[];
  /** Modèles propres à l'espace (sinon : modèles par défaut). */
  customized: boolean;
}

const sections = (titles: readonly string[]) =>
  titles.map((title) => `## ${title}\n\n- \n`).join('\n');

/** Modèles d'un espace qui ne les a jamais modifiés. */
export const DEFAULT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: 'procedure',
    name: 'Procédure',
    nodeType: 'procedure',
    documentTitle: 'Procédure',
    body: [
      '## Prérequis\n\n- \n',
      '## Étapes\n\n1. \n',
      '## Vérification\n\n- \n',
      '## Retour arrière\n\n- \n',
    ].join('\n'),
  },
  {
    id: 'component',
    name: 'Composant',
    nodeType: 'component',
    documentTitle: 'Fiche composant',
    body: sections([
      'Rôle',
      'Responsabilités',
      'Dépendances',
      'Configuration',
      'Points d’attention',
    ]),
  },
  {
    id: 'data',
    name: 'Donnée',
    nodeType: 'data',
    documentTitle: 'Fiche donnée',
    body: sections(['Schéma', 'Origine', 'Consommateurs']),
  },
  {
    id: 'adr',
    name: 'Décision (ADR)',
    nodeType: 'concept',
    documentTitle: 'Décision',
    body: sections(['Contexte', 'Décision', 'Conséquences', 'Alternatives']),
  },
];

// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

const line = (what: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${what} est obligatoire.`)
    .max(max, `${what} ne doit pas dépasser ${max} caractères.`)
    .refine((value) => !CONTROL_CHARS.test(value), {
      message: `${what} contient des caractères non autorisés.`,
    });

export const templateIdSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/, 'Identifiant de modèle invalide.');

export const documentTemplateSchema = z.strictObject({
  id: templateIdSchema,
  name: line('Le nom du modèle', TEMPLATE_NAME_MAX_LENGTH),
  nodeType: z.enum(NODE_TYPES),
  documentTitle: line('Le titre du document', TITLE_MAX_LENGTH),
  body: z
    .string()
    .max(
      TEMPLATE_BODY_MAX_LENGTH,
      `Le modèle ne doit pas dépasser ${TEMPLATE_BODY_MAX_LENGTH} caractères.`,
    ),
});

export const templateListSchema = z
  .array(documentTemplateSchema)
  .max(TEMPLATES_MAX_COUNT, `${TEMPLATES_MAX_COUNT} modèles au plus.`)
  .refine((list) => new Set(list.map((t) => t.id)).size === list.length, {
    message: 'Deux modèles ont le même identifiant.',
  })
  .refine(
    (list) =>
      new Set(list.map((t) => t.name.toLocaleLowerCase('fr'))).size ===
      list.length,
    { message: 'Deux modèles portent le même nom.' },
  );

/**
 * Modèles proposés pour un type de nœud : ceux du type d'abord, puis les
 * autres (un modèle reste utilisable ailleurs).
 */
export function templatesFor(
  templates: readonly DocumentTemplate[],
  nodeType: NodeType,
): { own: DocumentTemplate[]; others: DocumentTemplate[] } {
  return {
    own: templates.filter((t) => t.nodeType === nodeType),
    others: templates.filter((t) => t.nodeType !== nodeType),
  };
}

/** Modèle proposé par défaut à la création d'un nœud de ce type, ou `null`. */
export function defaultTemplateFor(
  templates: readonly DocumentTemplate[],
  nodeType: NodeType,
): DocumentTemplate | null {
  return templates.find((t) => t.nodeType === nodeType) ?? null;
}

/** Recherche par identifiant ou par nom (sans casse) — pour le MCP. */
export function findTemplate(
  templates: readonly DocumentTemplate[],
  key: string,
): DocumentTemplate | null {
  const wanted = key.trim().toLocaleLowerCase('fr');
  return (
    templates.find((t) => t.id === wanted) ??
    templates.find((t) => t.name.toLocaleLowerCase('fr') === wanted) ??
    null
  );
}

/** Nouvel identifiant de modèle, distinct de ceux de la liste. */
export function newTemplateId(
  templates: readonly DocumentTemplate[],
  name: string,
): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'modele';
  const taken = new Set(templates.map((t) => t.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
