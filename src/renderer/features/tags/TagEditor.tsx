import { useId, useState, type FormEvent } from 'react';
import { TAG_NAME_MAX_LENGTH } from '../../../shared/domain';
import type { TagInfo } from '../../../shared/model';
import { useClient, useRunner } from '../../app/context';

export interface TagEditorProps {
  nodeId: string;
  nodeTags: TagInfo[];
  allTags: TagInfo[];
  /** Appelé après une modification (tags du nœud ou liste globale). */
  onChanged(): void;
}

/** Tags d'un nœud : retrait, ajout d'un tag existant ou création à la volée. */
export function TagEditor({
  nodeId,
  nodeTags,
  allTags,
  onChanged,
}: TagEditorProps) {
  const client = useClient();
  const run = useRunner();
  const inputId = useId();
  const listId = useId();
  const [draft, setDraft] = useState('');

  const assigned = new Set(nodeTags.map((tag) => tag.id));
  const suggestions = allTags.filter((tag) => !assigned.has(tag.id));

  const setTags = async (tagIds: string[]) => {
    const result = await run(() =>
      client.call('node:setTags', { id: nodeId, tagIds }),
    );
    if (result) onChanged();
    return result;
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!name) return;
    const existing = allTags.find(
      (tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    const tag =
      existing ?? (await run(() => client.call('tag:create', { name })));
    if (!tag) return;
    if (!assigned.has(tag.id)) await setTags([...assigned, tag.id]);
    else onChanged();
    setDraft('');
  };

  return (
    <div className="tag-editor">
      {nodeTags.length > 0 ? (
        <ul className="chips" aria-label="Tags du nœud">
          {nodeTags.map((tag) => (
            <li key={tag.id} className="chip">
              {tag.color && (
                <span
                  className="chip-color"
                  style={{ background: tag.color }}
                  aria-hidden="true"
                />
              )}
              {tag.name}
              <button
                type="button"
                className="chip-remove"
                aria-label={`Retirer le tag ${tag.name}`}
                onClick={() =>
                  void setTags([...assigned].filter((id) => id !== tag.id))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Aucun tag.</p>
      )}
      <form className="inline-form" onSubmit={add}>
        <label htmlFor={inputId} className="visually-hidden">
          Ajouter un tag
        </label>
        <input
          id={inputId}
          type="text"
          list={listId}
          value={draft}
          maxLength={TAG_NAME_MAX_LENGTH}
          placeholder="Ajouter un tag…"
          onChange={(event) => setDraft(event.target.value)}
        />
        <datalist id={listId}>
          {suggestions.map((tag) => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>
        <button type="submit" className="secondary" disabled={!draft.trim()}>
          Ajouter
        </button>
      </form>
    </div>
  );
}
