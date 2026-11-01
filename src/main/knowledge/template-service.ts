/**
 * Modèles de documents de l'espace. Stockés en JSON dans workspace_settings
 * (clé `templates`) seulement une fois modifiés : un espace qui n'y a jamais
 * touché suit les modèles par défaut de la version de Nodal, sans migration.
 * La liste est toujours lue et écrite d'un bloc (une seule boîte de
 * dialogue), et validée à chaque lecture.
 */
import { NodalError } from '../../shared/errors';
import type { DocumentInfo } from '../../shared/model';
import {
  DEFAULT_TEMPLATES,
  findTemplate,
  templateListSchema,
  type DocumentTemplate,
  type TemplateList,
} from '../../shared/templates';
import { inTransaction } from '../database/transaction';
import type { ServiceContext } from './context';
import { DocumentService } from './document-service';

/** Clé de workspace_settings (aussi écrite par l'import natif). */
export const TEMPLATES_SETTING_KEY = 'templates';
const KEY = TEMPLATES_SETTING_KEY;

function storedValue(ctx: ServiceContext): string | null {
  const row = ctx.db
    .prepare(
      'SELECT value FROM workspace_settings WHERE workspace_id = ? AND key = ?',
    )
    .get(ctx.workspaceId, KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Modèles de l'espace ; une valeur illisible retombe sur les défauts. */
export function readTemplates(ctx: ServiceContext): TemplateList {
  const stored = storedValue(ctx);
  if (stored !== null) {
    try {
      const parsed = templateListSchema.safeParse(JSON.parse(stored));
      if (parsed.success) return { templates: parsed.data, customized: true };
    } catch {
      // JSON modifié à la main : modèles par défaut.
    }
  }
  return {
    templates: DEFAULT_TEMPLATES.map((template) => ({ ...template })),
    customized: false,
  };
}

/** Remplace la liste des modèles de l'espace. */
export function saveTemplates(
  ctx: ServiceContext,
  templates: readonly DocumentTemplate[],
): TemplateList {
  const parsed = templateListSchema.safeParse(templates);
  if (!parsed.success) {
    throw new NodalError(
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Modèles invalides.',
    );
  }
  ctx.db
    .prepare(
      `INSERT INTO workspace_settings (workspace_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = excluded.value`,
    )
    .run(ctx.workspaceId, KEY, JSON.stringify(parsed.data));
  return readTemplates(ctx);
}

/** Revient aux modèles par défaut. */
export function resetTemplates(ctx: ServiceContext): TemplateList {
  ctx.db
    .prepare(
      'DELETE FROM workspace_settings WHERE workspace_id = ? AND key = ?',
    )
    .run(ctx.workspaceId, KEY);
  return readTemplates(ctx);
}

/** Modèle désigné par son identifiant ou son nom ; erreur s'il n'existe pas. */
export function requireTemplate(
  ctx: ServiceContext,
  key: string,
): DocumentTemplate {
  const { templates } = readTemplates(ctx);
  const template = findTemplate(templates, key);
  if (!template) {
    const names = templates.map((t) => `« ${t.name} »`).join(', ');
    throw new NodalError(
      'NOT_FOUND',
      `Modèle « ${key} » introuvable. Modèles de l'espace : ${names || 'aucun'}.`,
    );
  }
  return template;
}

/**
 * Ajoute au nœud un document Markdown rempli avec le modèle. `title`
 * remplace le titre prévu par le modèle.
 */
export function addDocumentFromTemplate(
  ctx: ServiceContext,
  nodeId: string,
  template: DocumentTemplate,
  title?: string,
): DocumentInfo {
  const documents = new DocumentService(() => ctx);
  return inTransaction(ctx.db, () => {
    const document = documents.create({
      nodeId,
      title: title ?? template.documentTitle,
      contentType: 'markdown',
    });
    return documents.update({ id: document.id, body: template.body });
  });
}
