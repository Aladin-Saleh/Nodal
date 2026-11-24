import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentService } from '../../src/main/knowledge/document-service';
import { NodeService } from '../../src/main/knowledge/node-service';
import { contextHookOutput, promptKeywords } from '../../src/mcp/context-hook';
import {
  contextSessionFile,
  REPEAT_AFTER_PROMPTS,
} from '../../src/mcp/context-session';
import { testWorkspaceFixture } from '../helpers/test-workspace';

const workspace = testWorkspaceFixture();
let file: string;

beforeEach(() => {
  const { context, service } = workspace();
  file = service.getCurrent()!.filePath;
  const nodes = new NodeService(context);
  const documents = new DocumentService(context);
  const server = nodes.create({
    parentId: null,
    title: 'Serveur MCP',
    nodeType: 'component',
  }).id;
  nodes.update({ id: server, summary: 'Exécuté par Node, pas par Electron.' });
  const doc = documents.create({
    nodeId: server,
    title: 'Décision',
    contentType: 'markdown',
  }).id;
  documents.update({
    id: doc,
    body: '# Pourquoi Node\n\nElectron écrit une ligne vide sur stdout.\n',
  });
  nodes.create({ parentId: null, title: 'Electron', nodeType: 'concept' });
});

/** Contexte ajouté par le hook pour une demande, ou `null`. */
function contextFor(
  prompt: string,
  event = 'UserPromptSubmit',
  session?: string,
) {
  const output = contextHookOutput(
    file,
    JSON.stringify({ prompt, hook_event_name: event, session_id: session }),
  );
  if (!output) return null;
  const parsed = JSON.parse(output) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  return parsed.hookSpecificOutput;
}

describe('promptKeywords', () => {
  it('garde les mots porteurs, sans accents ni mots courants', () => {
    expect(
      promptKeywords(
        'Pourquoi le serveur MCP tourne-t-il sous Node ? Écris 2 tests',
      ),
    ).toEqual(['serveur', 'mcp', 'tourne', 'node', 'ecris', 'tests']);
  });
});

describe('contexte automatique (hook)', () => {
  it('ajoute les nœuds et documents pertinents à la demande', () => {
    const hook = contextFor('pourquoi le serveur MCP utilise Node ?');
    expect(hook?.hookEventName).toBe('UserPromptSubmit');
    expect(hook?.additionalContext).toContain('<nodal-context>');
    expect(hook?.additionalContext).toContain('Serveur MCP');
    expect(hook?.additionalContext).toContain('ligne vide sur stdout');
  });

  it('reprend l’événement de Gemini CLI', () => {
    expect(contextFor('serveur MCP', 'BeforeAgent')?.hookEventName).toBe(
      'BeforeAgent',
    );
  });

  it('écarte les nœuds qui ne partagent qu’un mot d’une longue demande', () => {
    const hook = contextFor(
      'installer electron forge avec webpack et typescript',
    );
    expect(hook).toBeNull();
  });

  it('ne dit rien sans sujet, pour une commande ou une entrée invalide', () => {
    expect(contextFor('écris une fonction fibonacci en rust')).toBeNull();
    expect(contextFor('/mcp serveur')).toBeNull();
    expect(contextHookOutput(file, 'pas du json')).toBe('');
    expect(contextHookOutput('C:/absent.nodal', '{"prompt":"serveur"}')).toBe(
      '',
    );
  });

  it('un nœud trouvé surtout par ses documents ne donne que son résumé', () => {
    const hook = contextFor('pourquoi electron écrit une ligne vide');
    expect(hook?.additionalContext).toContain('Exécuté par Node');
    expect(hook?.additionalContext).not.toContain('--- document');
  });

  it('masque les secrets des documents', () => {
    const { context } = workspace();
    const nodes = new NodeService(context);
    const [server] = nodes
      .list()
      .filter((node) => node.title === 'Serveur MCP');
    const documents = new DocumentService(context);
    const doc = documents.create({
      nodeId: server!.id,
      title: 'Accès',
      contentType: 'markdown',
    }).id;
    const token = `ghp_${'a1B2'.repeat(10)}`;
    documents.update({ id: doc, body: `Serveur MCP, jeton ${token}.` });
    const hook = contextFor('quel jeton pour le serveur MCP ?');
    expect(hook?.additionalContext).toContain('[masqué]');
    expect(hook?.additionalContext).not.toContain(token);
  });

  it('ne répète pas un nœud dans une session, sauf modifié ou après un temps', () => {
    const session = `session-${file}`;
    const ask = (name = session) =>
      contextFor('serveur MCP et Node', 'UserPromptSubmit', name);
    const state = contextSessionFile(session, file);
    try {
      expect(ask()?.additionalContext).toContain('Serveur MCP');
      expect(ask()).toBeNull();
      // Une autre session part de zéro.
      expect(ask()).toBeNull();
      const other = contextSessionFile(`${session}-2`, file);
      expect(ask(`${session}-2`)).not.toBeNull();
      fs.rmSync(other, { force: true });

      const nodes = new NodeService(workspace().context);
      const [server] = nodes
        .list()
        .filter((node) => node.title === 'Serveur MCP');
      const saved = JSON.parse(fs.readFileSync(state, 'utf8')) as {
        sent: Record<string, { version: string }>;
      };
      saved.sent[server!.id]!.version = 'ancienne';
      fs.writeFileSync(state, JSON.stringify(saved));
      expect(ask()).not.toBeNull();

      let repeated = 0;
      for (let i = 0; i < REPEAT_AFTER_PROMPTS; i++) if (ask()) repeated++;
      expect(repeated).toBe(1);

      // État illisible : on répète, sans erreur.
      fs.writeFileSync(state, 'pas du json');
      expect(ask()).not.toBeNull();
    } finally {
      fs.rmSync(state, { force: true });
    }
  });
});
