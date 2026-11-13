import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentService } from '../../src/main/knowledge/document-service';
import { NodeService } from '../../src/main/knowledge/node-service';
import { contextHookOutput, promptKeywords } from '../../src/mcp/context-hook';
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
function contextFor(prompt: string, event = 'UserPromptSubmit') {
  const output = contextHookOutput(
    file,
    JSON.stringify({ prompt, hook_event_name: event }),
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
});
