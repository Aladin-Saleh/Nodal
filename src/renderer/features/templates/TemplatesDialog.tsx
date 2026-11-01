/**
 * Modèles de documents de l'espace : créer, modifier, supprimer, revenir aux
 * modèles par défaut. Les modifications sont faites sur une copie et
 * enregistrées d'un bloc.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import {
  NODE_TYPES,
  NODE_TYPE_LABELS,
  TITLE_MAX_LENGTH,
  type NodeType,
} from '../../../shared/domain';
import {
  newTemplateId,
  TEMPLATE_BODY_MAX_LENGTH,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATES_MAX_COUNT,
  type DocumentTemplate,
} from '../../../shared/templates';
import { useClient, useReportError, useRunner } from '../../app/context';
import { Modal } from '../../components/Modal';

export function TemplatesDialog({ onClose }: { onClose(): void }) {
  const client = useClient();
  const run = useRunner();
  const reportError = useReportError();
  const nameId = useId();
  const typeId = useId();
  const titleId = useId();
  const bodyId = useId();
  const [templates, setTemplates] = useState<DocumentTemplate[] | null>(null);
  const [customized, setCustomized] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(
    (list: { templates: DocumentTemplate[]; customized: boolean }) => {
      setTemplates(list.templates);
      setCustomized(list.customized);
      setSelectedId((current) =>
        list.templates.some((t) => t.id === current)
          ? current
          : (list.templates[0]?.id ?? null),
      );
      setDirty(false);
    },
    [],
  );

  useEffect(() => {
    client.call('template:list').then(load, reportError);
  }, [client, load, reportError]);

  const selected = templates?.find((t) => t.id === selectedId) ?? null;

  const change = (changes: Partial<Omit<DocumentTemplate, 'id'>>) => {
    if (!selected) return;
    setTemplates((list) =>
      list!.map((t) => (t.id === selected.id ? { ...t, ...changes } : t)),
    );
    setDirty(true);
  };

  const add = () => {
    if (!templates) return;
    const name = 'Nouveau modèle';
    const template: DocumentTemplate = {
      id: newTemplateId(templates, name),
      name: uniqueName(templates, name),
      nodeType: 'generic',
      documentTitle: 'Document',
      body: '## Section\n\n- \n',
    };
    setTemplates([...templates, template]);
    setSelectedId(template.id);
    setDirty(true);
  };

  const remove = () => {
    if (!templates || !selected) return;
    const index = templates.indexOf(selected);
    const next = templates.filter((t) => t.id !== selected.id);
    setTemplates(next);
    setSelectedId(next[Math.min(index, next.length - 1)]?.id ?? null);
    setDirty(true);
  };

  const save = async () => {
    if (!templates) return;
    const saved = await run(() => client.call('template:save', { templates }));
    if (saved) {
      load(saved);
      onClose();
    }
  };

  const reset = async () => {
    const list = await run(() => client.call('template:reset'));
    if (list) load(list);
  };

  return (
    <Modal
      title="Modèles de documents"
      size="large"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="secondary left"
            disabled={!customized && !dirty}
            onClick={() => void reset()}
          >
            Rétablir les modèles par défaut
          </button>
          <button type="button" className="secondary" onClick={onClose}>
            Annuler
          </button>
          <button type="button" disabled={!dirty} onClick={() => void save()}>
            Enregistrer
          </button>
        </>
      }
    >
      <p className="muted">
        Proposés à la création d’un nœud (selon son type) ou d’un document.
        Modèles propres à cet espace
        {customized ? '' : ' (par défaut pour l’instant)'}.
      </p>
      {templates && (
        <div className="templates">
          <div className="templates-list">
            <ul role="listbox" aria-label="Modèles">
              {templates.map((template) => (
                <li
                  key={template.id}
                  role="option"
                  aria-selected={template.id === selectedId}
                  tabIndex={0}
                  onClick={() => setSelectedId(template.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(template.id);
                    }
                  }}
                >
                  <span>{template.name || 'Sans nom'}</span>
                  <span className="muted">
                    {NODE_TYPE_LABELS[template.nodeType]}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="secondary"
              disabled={templates.length >= TEMPLATES_MAX_COUNT}
              onClick={add}
            >
              Nouveau modèle
            </button>
          </div>
          {selected ? (
            <div className="form templates-editor">
              <label htmlFor={nameId}>Nom</label>
              <input
                id={nameId}
                type="text"
                value={selected.name}
                maxLength={TEMPLATE_NAME_MAX_LENGTH}
                onChange={(event) => change({ name: event.target.value })}
              />
              <label htmlFor={typeId}>Proposé pour le type</label>
              <select
                id={typeId}
                value={selected.nodeType}
                onChange={(event) =>
                  change({ nodeType: event.target.value as NodeType })
                }
              >
                {NODE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {NODE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <label htmlFor={titleId}>Titre du document créé</label>
              <input
                id={titleId}
                type="text"
                value={selected.documentTitle}
                maxLength={TITLE_MAX_LENGTH}
                onChange={(event) =>
                  change({ documentTitle: event.target.value })
                }
              />
              <label htmlFor={bodyId}>Contenu (Markdown)</label>
              <textarea
                id={bodyId}
                rows={12}
                className="templates-body"
                value={selected.body}
                maxLength={TEMPLATE_BODY_MAX_LENGTH}
                onChange={(event) => change({ body: event.target.value })}
              />
              <div className="inline-form">
                <button
                  type="button"
                  className="secondary danger"
                  onClick={remove}
                >
                  Supprimer ce modèle
                </button>
              </div>
            </div>
          ) : (
            <p className="muted">Aucun modèle : la création reste vide.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

function uniqueName(templates: readonly DocumentTemplate[], base: string) {
  const taken = new Set(templates.map((t) => t.name.toLocaleLowerCase('fr')));
  if (!taken.has(base.toLocaleLowerCase('fr'))) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLocaleLowerCase('fr'))) n += 1;
  return `${base} ${n}`;
}
