import { useEffect, useId, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useClient } from '../../app/context';
import {
  MCP_CLIENTS,
  MCP_CLIENT_LABELS,
  SERVER_NAME,
  mcpSetup,
  type McpClient,
} from './mcp-clients';

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
  const [serverPath, setServerPath] = useState<string | null>(null);
  const [allowWrites, setAllowWrites] = useState(true);
  const [assistant, setAssistant] = useState<McpClient>('claude-code');
  const writesId = useId();
  const assistantId = useId();

  useEffect(() => {
    let active = true;
    void client.call('app:getInfo').then(
      (info) => active && setServerPath(info.mcpServerPath),
      () => active && setServerPath(null),
    );
    return () => {
      active = false;
    };
  }, [client]);

  const setup = serverPath
    ? mcpSetup(assistant, [serverPath, workspaceFile], !allowWrites)
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
        l’affichage se met à jour quand l’assistant écrit. Node.js 22.13 ou plus
        récent doit être installé.
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
      {setup ? (
        <>
          <CopyBlock
            label={`${MCP_CLIENT_LABELS[assistant]} — ${setup.label}`}
            text={setup.text}
          />
          <p className="muted">{setup.hint}</p>
          <p className="muted">
            Les mises à jour de Nodal ne demandent rien : le serveur est
            remplacé au même endroit. Si le fichier de l’espace change de place,
            refaites cette configuration.
          </p>
          {setup.instructionsFile && (
            <>
              <h3>Consulter Nodal d’abord</h3>
              <p className="muted">
                Ajoutez ces consignes au fichier d’instructions de votre projet
                pour que l’assistant interroge Nodal avant de parcourir les
                fichiers ou de répondre de mémoire.
              </p>
              <CopyBlock
                label={setup.instructionsFile}
                text={assistantInstructions(workspaceName, allowWrites)}
              />
            </>
          )}
        </>
      ) : (
        <p className="muted">Chargement…</p>
      )}
    </Modal>
  );
}
