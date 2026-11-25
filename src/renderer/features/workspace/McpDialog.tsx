import { useEffect, useId, useState } from 'react';
import type { CodeRootInfo } from '../../../shared/code-anchors';
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
  assistantInstructions,
  INSTRUCTIONS_FILE,
  isProjectClient,
  MCP_CLIENTS,
  MCP_CLIENT_LABELS,
  mcpSetup,
  type McpClient,
} from '../../../shared/mcp-clients';

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
  const [repos, setRepos] = useState<CodeRootInfo[]>([]);
  useEffect(() => {
    let active = true;
    void client.call('code:getRoots').then(
      (roots) => active && setRepos(roots),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [client, done]);
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
            ? 'Ajouter un repo…'
            : `Connecter ${MCP_CLIENT_LABELS[assistant]}`}
        </button>
      </div>
      {isProjectClient(assistant) && (
        <p className="muted">
          Choisissez le dossier du repo : {MCP_CLIENT_LABELS[assistant]} y sera
          relié à cet espace. Ses consignes sont ajoutées à{' '}
          {INSTRUCTIONS_FILE[assistant]}. Ouvrez-le ensuite dans ce dossier et
          tapez /nodal-scan : le repo est documenté ici et relié au reste.
          Autant de repos que voulu dans le même espace ; vos autres réglages
          sont conservés.
        </p>
      )}
      {isProjectClient(assistant) && repos.length > 0 && (
        <p className="muted">
          Repos de l’espace : {repos.map((repo) => repo.path).join(' ; ')}
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
              label={`Consignes : ${setup.instructionsFile}`}
              text={assistantInstructions(workspaceName, allowWrites)}
            />
          )}
        </details>
      )}
    </Modal>
  );
}
