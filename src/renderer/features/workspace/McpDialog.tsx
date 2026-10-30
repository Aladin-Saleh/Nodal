import { useEffect, useId, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useClient } from '../../app/context';

/** Nom du serveur dans la configuration de l'assistant. */
const SERVER_NAME = 'nodal';

const quote = (value: string) => `"${value.replaceAll('"', '\\"')}"`;

/**
 * Consignes à placer dans CLAUDE.md / AGENTS.md pour que l'assistant consulte
 * Nodal avant de lire des fichiers ou de répondre de mémoire (et, si
 * l'écriture est autorisée, y consigne ce qu'il apprend).
 */
export function assistantInstructions(
  workspaceName: string,
  allowWrites: boolean,
): string {
  const lines = [
    `## Base de connaissances Nodal « ${workspaceName} »`,
    '',
    `Avant de répondre à une question sur ce sujet, de parcourir des fichiers ou de répondre de mémoire, consultez d'abord Nodal (serveur MCP \`${SERVER_NAME}\`) :`,
    '',
    '- commencez par `nodal_search` : il renvoie le résumé des nœuds et le contenu des documents trouvés, ce qui suffit souvent pour répondre ; pour une question à plusieurs volets, lancez plusieurs recherches en parallèle ;',
    '- approfondissez au besoin avec `nodal_get_node` et `nodal_read_document` ; `nodal_overview` sert à vous orienter quand la question est vague.',
    '',
    'Ne lisez les fichiers sources que si Nodal ne suffit pas, et dites-le.',
  ];
  if (allowWrites) {
    lines.push(
      '',
      'Quand vous apprenez quelque chose de durable (décision, explication, procédure, lien entre deux notions), enregistrez-le dans Nodal : complétez le nœud existant plutôt que d’en créer un nouveau, et reliez les notions avec `nodal_link`. Pour enregistrer plusieurs choses à la fois (nœud, documents, relations, tags), utilisez `nodal_apply` : un seul appel. Chaque modification est journalisée et peut être annulée par l’utilisateur.',
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
 * Configuration d'un assistant IA (Claude Code, Claude Desktop, Cursor…)
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
  const writesId = useId();

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

  const args = serverPath
    ? [serverPath, workspaceFile, ...(allowWrites ? [] : ['--read-only'])]
    : [];
  const json =
    serverPath &&
    JSON.stringify(
      {
        mcpServers: {
          [SERVER_NAME]: { command: 'node', args },
        },
      },
      null,
      2,
    );

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
      {serverPath && json ? (
        <>
          <CopyBlock
            label="Claude Code (terminal)"
            text={`claude mcp add ${SERVER_NAME} -- node ${args.map(quote).join(' ')}`}
          />
          <CopyBlock
            label="Claude Desktop, Cursor… (fichier de configuration JSON)"
            text={json}
          />
          <p className="muted">
            Après une mise à jour ou un déplacement de Nodal, ou si le fichier
            de l’espace change de place, refaites cette configuration.
          </p>
          <h3>Consulter Nodal d’abord</h3>
          <p className="muted">
            Ajoutez ces consignes au fichier d’instructions de votre projet pour
            que l’assistant interroge Nodal avant de parcourir les fichiers ou
            de répondre de mémoire.
          </p>
          <CopyBlock
            label="CLAUDE.md (Claude Code) ou AGENTS.md (Codex, Cursor…)"
            text={assistantInstructions(workspaceName, allowWrites)}
          />
        </>
      ) : (
        <p className="muted">Chargement…</p>
      )}
    </Modal>
  );
}
