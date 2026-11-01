/**
 * Choix d'un modèle de document (création d'un nœud ou d'un document) :
 * les modèles du type de nœud d'abord, puis les autres, et « Aucun ».
 */
import { useEffect, useState } from 'react';
import { NODE_TYPE_LABELS, type NodeType } from '../../../shared/domain';
import { templatesFor, type DocumentTemplate } from '../../../shared/templates';
import { useClient } from '../../app/context';

/** Modèles de l'espace ouvert ; liste vide tant qu'ils ne sont pas lus. */
export function useTemplates(): DocumentTemplate[] {
  const client = useClient();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  useEffect(() => {
    let active = true;
    client.call('template:list').then(
      (list) => active && setTemplates(list.templates),
      // Sans modèles, la création reste possible (« Aucun »).
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [client]);
  return templates;
}

export function TemplateSelect({
  id,
  templates,
  nodeType,
  value,
  onChange,
}: {
  id: string;
  templates: readonly DocumentTemplate[];
  /** Type du nœud : ses modèles sont proposés en premier. */
  nodeType: NodeType | null;
  /** Identifiant du modèle, ou chaîne vide pour « Aucun ». */
  value: string;
  onChange(templateId: string): void;
}) {
  const { own, others } = nodeType
    ? templatesFor(templates, nodeType)
    : { own: [], others: [...templates] };
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Aucun</option>
      {own.length > 0 && (
        <optgroup label={`Pour « ${NODE_TYPE_LABELS[nodeType!]} »`}>
          {own.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label={own.length > 0 ? 'Autres modèles' : 'Modèles'}>
          {others.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
