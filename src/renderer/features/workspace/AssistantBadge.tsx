import type { AssistantOrigin } from '../../../shared/model';

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

/** Pastille « IA » d'un élément créé par un assistant (via MCP). */
export function AssistantBadge({
  origin,
  what,
}: {
  origin: AssistantOrigin | null;
  /** Ex. « Nœud créé », « Relation créée ». */
  what: string;
}) {
  if (!origin) return null;
  const by = origin.client ? ` (${origin.client})` : '';
  const label = `${what} par l’assistant IA${by} le ${dateFormat.format(new Date(origin.createdAt))}`;
  return (
    <span className="badge assistant-badge" title={label} aria-label={label}>
      IA
    </span>
  );
}
