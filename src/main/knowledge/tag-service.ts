import { NodalError } from '../../shared/errors';
import type { CreateTagInput, UpdateTagInput } from '../../shared/ipc-contract';
import type { TagInfo } from '../../shared/model';
import { notFound, type ContextProvider, type ServiceContext } from './context';
import { asRow, asRows, toTagInfo, type TagRow } from './rows';

const TAG_SELECT = `SELECT t.id, t.name, t.color,
  (SELECT count(*) FROM node_tag nt WHERE nt.tag_id = t.id) AS usage_count
  FROM tag t`;

export function listNodeTags(ctx: ServiceContext, nodeId: string): TagInfo[] {
  return asRows<TagRow>(
    ctx.db
      .prepare(
        `${TAG_SELECT} JOIN node_tag nt2 ON nt2.tag_id = t.id
         WHERE nt2.node_id = ? ORDER BY t.name COLLATE NOCASE`,
      )
      .all(nodeId),
  ).map(toTagInfo);
}

function getTag(ctx: ServiceContext, id: string): TagInfo {
  const found = asRow<TagRow>(
    ctx.db
      .prepare(`${TAG_SELECT} WHERE t.id = ? AND t.workspace_id = ?`)
      .get(id, ctx.workspaceId),
  );
  if (!found) throw notFound('Tag');
  return toTagInfo(found);
}

function assertNameAvailable(
  ctx: ServiceContext,
  name: string,
  exceptId: string | null,
): void {
  // La colonne est en COLLATE NOCASE : la comparaison ignore la casse.
  const clash = ctx.db
    .prepare(
      'SELECT id FROM tag WHERE workspace_id = ? AND name = ? AND id IS NOT ?',
    )
    .get(ctx.workspaceId, name, exceptId);
  if (clash) {
    throw new NodalError('CONFLICT', `Le tag « ${name} » existe déjà.`);
  }
}

/** Tags réutilisables d'un espace (§5.1). */
export class TagService {
  constructor(private readonly context: ContextProvider) {}

  list(): TagInfo[] {
    const ctx = this.context();
    return asRows<TagRow>(
      ctx.db
        .prepare(
          `${TAG_SELECT} WHERE t.workspace_id = ? ORDER BY t.name COLLATE NOCASE`,
        )
        .all(ctx.workspaceId),
    ).map(toTagInfo);
  }

  create(input: CreateTagInput): TagInfo {
    const ctx = this.context();
    assertNameAvailable(ctx, input.name, null);
    const id = ctx.newId();
    ctx.db
      .prepare(
        'INSERT INTO tag (id, workspace_id, name, color) VALUES (?, ?, ?, ?)',
      )
      .run(id, ctx.workspaceId, input.name, input.color ?? null);
    return getTag(ctx, id);
  }

  update(input: UpdateTagInput): TagInfo {
    const ctx = this.context();
    const current = getTag(ctx, input.id);
    if (input.name !== undefined)
      assertNameAvailable(ctx, input.name, input.id);
    ctx.db
      .prepare('UPDATE tag SET name = ?, color = ? WHERE id = ?')
      .run(
        input.name ?? current.name,
        input.color === undefined ? current.color : input.color,
        input.id,
      );
    return getTag(ctx, input.id);
  }

  /** Supprime le tag et ses associations (les nœuds sont conservés). */
  delete(id: string): void {
    const ctx = this.context();
    getTag(ctx, id);
    ctx.db.prepare('DELETE FROM tag WHERE id = ?').run(id);
  }
}
