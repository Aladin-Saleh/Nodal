import { NodalError } from '../../shared/errors';
import type {
  CreateRelationTypeInput,
  UpdateRelationTypeInput,
} from '../../shared/ipc-contract';
import type { RelationTypeInfo } from '../../shared/model';
import { notFound, type ContextProvider, type ServiceContext } from './context';
import { asRow, asRows } from './rows';

interface RelationTypeRow {
  id: string;
  name: string;
  color: string | null;
  is_builtin: number;
  usage_count: number;
}

const SELECT = `SELECT rt.id, rt.name, rt.color, rt.is_builtin,
  (SELECT count(*) FROM edge e WHERE e.relation_type_id = rt.id) AS usage_count
  FROM relation_type rt`;

function toInfo(row: RelationTypeRow): RelationTypeInfo {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isBuiltin: row.is_builtin === 1,
    usageCount: row.usage_count,
  };
}

export function listRelationTypes(ctx: ServiceContext): RelationTypeInfo[] {
  return asRows<RelationTypeRow>(
    ctx.db
      .prepare(`${SELECT} WHERE rt.workspace_id = ? ORDER BY rt.rowid`)
      .all(ctx.workspaceId),
  ).map(toInfo);
}

export function getRelationType(
  ctx: ServiceContext,
  id: string,
): RelationTypeInfo {
  const found = asRow<RelationTypeRow>(
    ctx.db
      .prepare(`${SELECT} WHERE rt.id = ? AND rt.workspace_id = ?`)
      .get(id, ctx.workspaceId),
  );
  if (!found) throw notFound('Type de relation');
  return toInfo(found);
}

function assertNameAvailable(
  ctx: ServiceContext,
  name: string,
  exceptId: string | null,
): void {
  // Colonne en COLLATE NOCASE : la comparaison ignore la casse.
  const clash = ctx.db
    .prepare(
      'SELECT 1 FROM relation_type WHERE workspace_id = ? AND name = ? AND id IS NOT ?',
    )
    .get(ctx.workspaceId, name, exceptId);
  if (clash) {
    throw new NodalError(
      'CONFLICT',
      `Le type de relation « ${name} » existe déjà.`,
    );
  }
}

/**
 * Types de relations propres à l'espace : préremplis à la création, puis
 * ajoutables, renommables et supprimables (§13).
 */
export class RelationTypeService {
  constructor(private readonly context: ContextProvider) {}

  list(): RelationTypeInfo[] {
    return listRelationTypes(this.context());
  }

  create(input: CreateRelationTypeInput): RelationTypeInfo {
    const ctx = this.context();
    assertNameAvailable(ctx, input.name, null);
    const id = ctx.newId();
    ctx.db
      .prepare(
        'INSERT INTO relation_type (id, workspace_id, name, color, is_builtin) VALUES (?, ?, ?, ?, 0)',
      )
      .run(id, ctx.workspaceId, input.name, input.color ?? null);
    return getRelationType(ctx, id);
  }

  update(input: UpdateRelationTypeInput): RelationTypeInfo {
    const ctx = this.context();
    const current = getRelationType(ctx, input.id);
    if (input.name !== undefined) {
      assertNameAvailable(ctx, input.name, input.id);
    }
    ctx.db
      .prepare('UPDATE relation_type SET name = ?, color = ? WHERE id = ?')
      .run(
        input.name ?? current.name,
        input.color === undefined ? current.color : input.color,
        input.id,
      );
    return getRelationType(ctx, input.id);
  }

  /** Refuse la suppression d'un type encore utilisé : aucune relation n'est perdue. */
  delete(id: string): void {
    const ctx = this.context();
    const current = getRelationType(ctx, id);
    if (current.usageCount > 0) {
      throw new NodalError(
        'CONFLICT',
        `Le type « ${current.name} » est utilisé par ${current.usageCount} relation(s). Changez ou supprimez d’abord ces relations.`,
      );
    }
    ctx.db.prepare('DELETE FROM relation_type WHERE id = ?').run(id);
  }
}
