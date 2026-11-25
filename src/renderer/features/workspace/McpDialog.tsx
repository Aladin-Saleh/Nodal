import { useEffect, useId, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useClient, useRunner } from '../../app/context';
import {
  contextHookCommand,
  contextHookSnippet,
  isContextHookClient,
  type ContextHookClient,
} from '../../../shared/context-hook';
import {
  AFTER_CONNECT,
  isProjectClient,
  MCP_CLIENTS,
  MCP_CLIENT_LABELS,
  SERVER_NAME,
  mcpSetup,
  type McpClient,
} from '../../../shared/mcp-clients';

/**
 * Consignes à placer dans CLAUDE.md / AGENTS.md pour que l'assistant consulte
 * Nodal avant de lire des fichiers ou de répondre de mémoire (et, si
 * l'écriture est autorisée, y consigne ce qu'il apprend).
 */
export function assistantInstructions(
  workspaceName: string,
  allowWrites: boolean,
): string {
  // Déclencheur seulement : le mode d'emploi des outils est dans les
  // consignes du serveur MCP, envoyées à chaque tour (pas de doublon).
  const lines = [
    `## Base de connaissances Nodal « ${workspaceName} »`,
    '',
    `Avant de répondre sur ce sujet, de parcourir des fichiers ou de répondre de mémoire, consultez Nodal (serveur MCP \`${SERVER_NAME}\`, en commençant par \`nodal_search\`). Ne lisez les fichiers sources que si Nodal ne suffit pas, et dites-le.`,
    '',
    'Exception : la question porte seulement sur ce que fait un fichier précis. Lisez-le directement ; les nœuds qui lui sont liés arrivent d’eux-mêmes avec le contexte automatique, ou par `nodal_for_files` s’il faut le pourquoi.',
    '',
    'Avant de modifier des fichiers du code, appelez `nodal_for_files` avec leurs chemins : il donne les nœuds qui les documentent.',
  ];
  if (allowWrites) {
    lines.push(
      '',
      'Enregistrez-y ce que vous apprenez de durable (décision, explication, procédure, lien entre notions), en complétant les nœuds existants ; plusieurs écritures : `nodal_apply`.',
      '',
      'Après avoir modifié des fichiers, mettez à jour les nœuds concernés et ancrez-y les nouveaux fichiers (`nodal_apply`, opération `anchor`).',
    );
  }
  return lines.join('\n');
}

/** Réglages globaux de l'assistant, pour une installation à la main. */
const USER_SETTINGS_FILE: Record<ContextHookClient, string> = {
  'claude-code': '~/.claude/settings.json',
  'gemini-cli': '~/.gemini/settings.json',
};

/** Connexion en un clic : configuration, skills et contexte automatique. */
function ConnectSection({
  assistant,
  allowWrites,
}: {
  assistant: McpClient;
  allowWrites: boolean;
}) {
  const client = useClient();
  const run = useRunner();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    files: string[];
    note: string | null;
  } | null>(null);
  const connect = async () => {
    setBusy(true);
    const result = await run(() =>
      client.call('assistant:connect', { client: assistant, allowWrites }),
    );
    setBusy(false);
    if (result) setDone(result);
  };
  return (
    <>
      <div className="mcp-hook-actions">
        <button type="button" disabled={busy} onClick={() => void connect()}>
          {isProjectClient(assistant)
            ? `Connecter ${MCP_CLIENT_LABELS[assistant]} à un projet…`
            : `Connecter ${MCP_CLIENT_LABELS[assistant]}`}
        </button>
      </div>
      {isProjectClient(assistant) && (
        <p className="muted">
          Choisissez le dossier du projet : Nodal y ajoute sa connexion, ses
          skills (/nodal-init pour documenter le code, /nodal-maj pour suivre
          ses changements…)
          {isContextHookClient(assistant) &&
            ' et le contexte automatique : à chaque demande, l’assistant reçoit ce que l’espace en sait'}
          . Vos autres réglages sont conservés.
        </p>
      )}
      {done && (
        <div role="status">
          <p>
            <strong>Connecté.</strong> {AFTER_CONNECT[assistant]}
          </p>
          {done.note && <p>{done.note}</p>}
          <p className="muted">Écrit : {done.files.join(' ; ')}</p>
        </div>
      )}
    </>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="mcp-snippet">
      <div className="mcp-snippet-header">
        <span>{label}</span>
        <button type="button" className="secondary" onClick={() => void copy()}>
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

/**
 * Configuration d'un assistant IA (Claude Code, Gemini CLI, Codex, Cursor…),
 * choisi dans une liste,
 * pour qu'il interroge l'espace via le serveur MCP de Nodal et, si
 * l'utilisateur l'autorise, l'enrichisse (modifications journalisées).
 */
export function McpDialog({
  workspaceName,
  workspaceFile,
  onClose,
}: {
  workspaceName: string;
  workspaceFile: string;
  onClose(): void;
}) {
  const client = useClient();
  const [paths, setPaths] = useState<{
    server: string;
    node: string;
  } | null>(null);
  const [allowWrites, setAllowWrites] = useState(true);
  const [assistant, setAssistant] = useState<McpClient>('claude-code');
  const writesId = useId();
  const assistantId = useId();

  useEffect(() => {
    let active = true;
    void client.call('app:getInfo').then(
      (info) =>
        active && setPaths({ server: info.mcpServerPath, node: info.nodePath }),
      () => active && setPaths(null),
    );
    return () => {
      active = false;
    };
  }, [client]);

  const setup = paths
    ? mcpSetup(
        assistant,
        [paths.server, workspaceFile],
        !allowWrites,
        paths.node,
      )
    : null;

  return (
    <Modal
      title="Connecter un assistant IA (MCP)"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <p className="muted">
        Un assistant compatible MCP peut consulter cet espace : recherche,
        lecture des nœuds et documents, exploration du graphe, avec des réponses
        au format TOON, économes en tokens. Nodal peut rester ouvert :
        l’affichage se met à jour quand l’assistant écrit.
      </p>
      <label htmlFor={assistantId}>Assistant</label>
      <select
        id={assistantId}
        value={assistant}
        onChange={(event) => setAssistant(event.target.value as McpClient)}
      >
        {MCP_CLIENTS.map((id) => (
          <option key={id} value={id}>
            {MCP_CLIENT_LABELS[id]}
          </option>
        ))}
      </select>
      <label htmlFor={writesId} className="checkbox">
        <input
          id={writesId}
          type="checkbox"
          checked={allowWrites}
          onChange={(event) => setAllowWrites(event.target.checked)}
        />
        Autoriser l’assistant à enrichir l’espace (créer des nœuds, des
        documents, des relations et des tags)
      </label>
      <p className="muted">
        {allowWrites
          ? 'Rien n’est jamais supprimé ; chaque modification est listée dans « Activité IA » et peut y être annulée.'
          : 'L’assistant pourra seulement lire l’espace.'}
      </p>
      <ConnectSection
        key={assistant}
        assistant={assistant}
        allowWrites={allowWrites}
      />
      <p className="muted">
        Les mises à jour de Nodal ne demandent rien. Si le fichier de l’espace
        change de place, reconnectez l’assistant.
      </p>
      {setup && paths && (
        <details className="mcp-manual">
          <summary>Configuration manuelle</summary>
          <CopyBlock
            label={`${MCP_CLIENT_LABELS[assistant]} — ${setup.label}`}
            text={setup.text}
          />
          <p className="muted">{setup.hint}</p>
          {isContextHookClient(assistant) && (
            <CopyBlock
              label={`Contexte automatique pour tous vos projets : ${USER_SETTINGS_FILE[assistant]}, à fusionner avec les réglages présents`}
              text={contextHookSnippet(
                assistant,
                contextHookCommand(
                  paths.server,
                  workspaceFile,
                  paths.node,
                  assistant,
                ),
              )}
            />
          )}
          {setup.instructionsFile && (
            <CopyBlock
              label={`Consignes facultatives : ${setup.instructionsFile}`}
              text={assistantInstructions(workspaceName, allowWrites)}
            />
          )}
        </details>
      )}
    </Modal>
  );
}
