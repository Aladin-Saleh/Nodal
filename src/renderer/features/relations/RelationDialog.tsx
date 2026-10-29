import { useId, useState, type FormEvent } from 'react';
import { EDGE_LABEL_MAX_LENGTH } from '../../../shared/domain';
import type { NodeSummary, RelationTypeInfo } from '../../../shared/model';
import { Modal } from '../../components/Modal';

export interface RelationFormValue {
  sourceId: string;
  targetId: string;
  relationTypeId: string;
  label: string | null;
}

export interface RelationDialogProps {
  title: string;
  nodes: readonly NodeSummary[];
  relationTypes: readonly RelationTypeInfo[];
  initial: Partial<RelationFormValue> & { sourceId: string };
  /** En modification, la source et la cible sont figées. */
  lockEnds?: boolean;
  submitLabel: string;
  onSubmit(value: RelationFormValue): void;
  onCancel(): void;
}

/** Choix de la cible, du type et du libellé d'une relation (§6.8). */
export function RelationDialog({
  title,
  nodes,
  relationTypes,
  initial,
  lockEnds = false,
  submitLabel,
  onSubmit,
  onCancel,
}: RelationDialogProps) {
  const ids = {
    source: useId(),
    target: useId(),
    type: useId(),
    label: useId(),
  };
  const [sourceId, setSourceId] = useState(initial.sourceId);
  const [targetId, setTargetId] = useState(initial.targetId ?? '');
  const [relationTypeId, setRelationTypeId] = useState(
    initial.relationTypeId ?? relationTypes[0]?.id ?? '',
  );
  const [label, setLabel] = useState(initial.label ?? '');

  const sorted = nodes.toSorted((a, b) => a.title.localeCompare(b.title));
  const valid = sourceId && targetId && relationTypeId && sourceId !== targetId;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit({
      sourceId,
      targetId,
      relationTypeId,
      label: label.trim() === '' ? null : label.trim(),
    });
  };

  const nodeSelect = (
    id: string,
    value: string,
    onChange: (value: string) => void,
    exclude: string,
  ) => (
    <select
      id={id}
      value={value}
      disabled={lockEnds}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Choisir un nœud…</option>
      {sorted
        .filter((node) => node.id !== exclude)
        .map((node) => (
          <option key={node.id} value={node.id}>
            {node.title}
          </option>
        ))}
    </select>
  );

  return (
    <Modal title={title} onClose={onCancel}>
      <form className="form" onSubmit={submit}>
        <label htmlFor={ids.source}>Source</label>
        {nodeSelect(ids.source, sourceId, setSourceId, targetId)}
        <label htmlFor={ids.type}>Type de relation</label>
        <select
          id={ids.type}
          value={relationTypeId}
          data-autofocus
          onChange={(event) => setRelationTypeId(event.target.value)}
        >
          {relationTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <label htmlFor={ids.target}>Cible</label>
        {nodeSelect(ids.target, targetId, setTargetId, sourceId)}
        <label htmlFor={ids.label}>Libellé (facultatif)</label>
        <input
          id={ids.label}
          type="text"
          value={label}
          maxLength={EDGE_LABEL_MAX_LENGTH}
          placeholder="Par défaut : le nom du type"
          onChange={(event) => setLabel(event.target.value)}
        />
        {relationTypes.length === 0 && (
          <p className="warning">
            Aucun type de relation : créez-en un depuis « Types de relations ».
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" disabled={!valid}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
