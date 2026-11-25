/**
 * Commandes (prompts MCP) : proposées par le client (« / » dans Claude Code),
 * elles ne coûtent rien tant qu'on ne les lance pas.
 */
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

const message = (text: string) => ({
  messages: [
    { role: 'user' as const, content: { type: 'text' as const, text } },
  ],
});

export function registerPrompts(server: McpServer, readOnly: boolean): void {
  server.registerPrompt(
    'explique',
    {
      title: 'Expliquer un sujet',
      description: 'Réponse tirée de Nodal, avec ce qui manque ou est dépassé',
      argsSchema: z.object({ sujet: z.string().describe('Sujet') }),
    },
    ({ sujet }) =>
      message(
        `Explique « ${sujet} » d'après Nodal : nodal_search (plusieurs recherches en parallèle si le sujet a plusieurs volets), puis le détail seulement si nécessaire. ` +
          'Cite les nœuds utilisés, les décisions et leurs raisons, les impasses connues (lessons), et signale ce qui est peut-être dépassé (stale) ou absent de la base.',
      ),
  );
  server.registerPrompt(
    'avant-modif',
    {
      title: 'Avant de modifier',
      description:
        'Ce que Nodal sait des fichiers à modifier, et ce qui dépend d’eux',
      argsSchema: z.object({
        fichiers: z.string().describe('Chemins, séparés par des espaces'),
      }),
    },
    ({ fichiers }) =>
      message(
        `Je vais modifier : ${fichiers}. Appelle nodal_for_files avec ces chemins, et nodal_impact si le changement est large. ` +
          'Donne ensuite, en 15 lignes au plus : ce qu’il faut savoir (décisions, pièges, impasses), ce qui est touché, les vérifications à faire après, et les fiches à mettre à jour. Ne modifie rien.',
      ),
  );
  if (readOnly) return;
  server.registerPrompt(
    'scan',
    {
      title: 'Documenter ce repo',
      description:
        'Analyse le repo, le documente dans Nodal et le relie à ce qui y est déjà',
      argsSchema: z.object({
        portee: z
          .string()
          .optional()
          .describe('rapide, complet, ou un dossier (facultatif)'),
      }),
    },
    ({ portee }) =>
      message(
        `Documente ce repo dans Nodal${portee ? ` (${portee})` : ''} : charge le skill nodal-scan (.claude/skills ou .agents/skills) et suis-le. ` +
          'Skill absent : arrête-toi et dis d’ajouter ce repo depuis Nodal (menu Assistant IA, « Connecter un assistant »).',
      ),
  );
  server.registerPrompt(
    'documenter',
    {
      title: 'Documenter le travail fait',
      description: 'Enregistre dans Nodal ce que cette session a de durable',
    },
    () =>
      message(
        'Enregistre dans Nodal ce que cette session a de durable : décisions et raisons, ce qui a été mesuré ou écarté, pièges, procédures ; pas le récit. ' +
          'Cherche d’abord les nœuds existants, complète-les, puis un seul nodal_apply : documents, ancrage des nouveaux fichiers (anchor), fichiers relus (review), relations prouvées (link avec evidence), leçons (lesson). ' +
          'Termine par la liste de ce qui a été écrit.',
      ),
  );
  server.registerPrompt(
    'a-revoir',
    {
      title: 'Revoir les fiches dépassées',
      description: 'Compare les fiches signalées au code et les remet à jour',
      argsSchema: z.object({
        sujet: z.string().optional().describe('Limiter à un sujet'),
      }),
    },
    ({ sujet }) =>
      message(
        `Revois les fiches possiblement dépassées${sujet ? ` sur « ${sujet} »` : ''} : nodal_health (lignes stale), au plus 3 nœuds. ` +
          'Pour chacun : lis la fiche et les fichiers modifiés, corrige ce qui est faux, puis nodal_apply avec review pour les fichiers lus. ' +
          'Ne déclare pas relu un fichier que tu n’as pas lu. Termine par ce qui reste à revoir.',
      ),
  );
  server.registerPrompt(
    'lecon',
    {
      title: 'Noter une leçon',
      description:
        'Impasse, correction ou nœuds utiles, pour les prochaines fois',
      argsSchema: z.object({
        lecon: z.string().describe('Ce qu’il faut retenir'),
      }),
    },
    ({ lecon }) =>
      message(
        `Note cette leçon dans Nodal : « ${lecon} ». Retrouve les nœuds concernés (nodal_search), puis nodal_apply avec une opération lesson : ` +
          'outcome dead_end, corrected (note = ce qui est juste) ou useful selon le cas, question formulée comme on la poserait la prochaine fois.',
      ),
  );
}
