import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentService } from '../../src/main/knowledge/document-service';
import { NodeService } from '../../src/main/knowledge/node-service';
import {
  contextHookOutput,
  promptKeywords,
  promptText,
} from '../../src/mcp/context-hook';
import {
  contextSessionFile,
  REPEAT_AFTER_PROMPTS,
} from '../../src/mcp/context-session';
import {
  setAnchors,
  writeCodeRoots,
} from '../../src/main/knowledge/anchor-service';
import { recordLesson } from '../../src/main/knowledge/lesson-service';
import { readLogFile } from '../../src/mcp/read-proof';
import { toolFiles } from '../../src/mcp/file-hook';
import { useTempDir } from '../helpers/temp-dir';
import { testWorkspaceFixture } from '../helpers/test-workspace';

const workspace = testWorkspaceFixture();
const tempDir = useTempDir();
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

describe('promptText', () => {
  it('écarte ce que l’assistant ajoute, garde le texte collé', () => {
    expect(
      promptText(
        '<task-notification>\n<status>completed</status>\n</task-notification>',
      ),
    ).toBe('');
    expect(
      promptText('<pasted_content id="9">\nserveur\n</pasted_content>'),
    ).toBe('serveur');
    // Bloc coupé : rien après lui n'est de l'utilisateur.
    expect(promptText('avant <system-reminder>a <b>')).toBe('avant');
  });

  it('ne garde d’un chemin absolu que son dernier nom', () => {
    expect(promptText('dans C:\\Users\\moi\\app\\hook.ts corrige')).toBe(
      'dans hook.ts corrige',
    );
    expect(promptText('lis /home/moi/app/hook.ts')).toBe('lis hook.ts');
    expect(promptText('et/ou src/mcp, https://a.b/c/d')).toBe(
      'et/ou src/mcp, https://a.b/c/d',
    );
    // Une commande reste une commande.
    expect(promptText('/mcp serveur')).toBe('/mcp serveur');
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

describe('leçons dans le contexte', () => {
  it('rappelle une impasse proche de la demande, une fois par session', () => {
    const { context } = workspace();
    recordLesson(context(), {
      question: 'Contourner le verrou Squirrel par variable',
      outcome: 'dead_end',
      nodeIds: [],
      note: 'La variable est ignorée.',
      client: null,
    });
    const session = `lecons-${file}`;
    const ask = () =>
      contextFor('comment contourner le verrou squirrel', undefined, session);
    try {
      const hook = ask();
      expect(hook?.additionalContext).toContain('La variable est ignorée.');
      expect(hook?.additionalContext).toContain('pistes déjà essayées');
      expect(ask()).toBeNull();
    } finally {
      fs.rmSync(contextSessionFile(session, file), { force: true });
    }
    // Un seul mot commun d'une longue demande : rien.
    expect(contextFor('écris une variable globale en rust')).toBeNull();
  });
});

describe('rappel avant un fichier ancré (PreToolUse)', () => {
  let root: string;
  let source: string;

  beforeEach(() => {
    root = tempDir();
    source = path.join(root, 'src', 'mcp', 'server.ts');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, '');
    const { context } = workspace();
    writeCodeRoots(context(), [root]);
    const all = new NodeService(context).list();
    const id = (title: string) => all.find((node) => node.title === title)!.id;
    setAnchors(context(), id('Electron'), ['src/**']);
    setAnchors(context(), id('Serveur MCP'), ['src/mcp/server.ts']);
  });

  const before = (toolInput: unknown, extra: Record<string, unknown> = {}) => {
    const output = contextHookOutput(
      file,
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        cwd: root,
        tool_input: toolInput,
        ...extra,
      }),
    );
    if (!output) return null;
    const { hookSpecificOutput } = JSON.parse(output) as {
      hookSpecificOutput: Record<string, string>;
    };
    // L'appel d'outil n'est ni bloqué ni autorisé d'office.
    expect(Object.keys(hookSpecificOutput)).toEqual([
      'hookEventName',
      'additionalContext',
    ]);
    return hookSpecificOutput.additionalContext!;
  };

  it('donne les nœuds du fichier, le plus précis d’abord', () => {
    const text = before({ file_path: source })!;
    expect(text).toContain('src/mcp/server.ts');
    expect(text.indexOf('Serveur MCP')).toBeLessThan(text.indexOf('Electron,'));
    // Résumé et titres des documents, pas leur contenu.
    expect(text).toContain('Exécuté par Node');
    expect(text).toContain('Décision');
    expect(text).not.toContain('ligne vide');
  });

  it('se tait pour un fichier non ancré, hors du projet, ou sans fichier', () => {
    expect(before({ file_path: path.join(root, 'README.md') })).toBeNull();
    expect(before({ file_path: path.join(tempDir(), 'x.ts') })).toBeNull();
    expect(before({ command: 'npm test' })).toBeNull();
    expect(before(null)).toBeNull();
  });

  it('reconnaît les fichiers cités par une commande', () => {
    expect(before({ command: 'sed -n 1,20p src/mcp/server.ts' })).toContain(
      'Serveur MCP',
    );
    expect(toolFiles({ command: 'cd src && cat mcp/server.ts' }, root)).toEqual(
      [source],
    );
    expect(
      toolFiles({ command: 'cat absent.ts https://a.b/server.ts' }, root),
    ).toEqual([]);
    // Texte d'un heredoc : pas une lecture.
    expect(
      toolFiles({ command: 'cat > n.md <<E\nsrc/mcp/server.ts\nE' }, root),
    ).toEqual([]);
  });

  it('une fois par session et par agent, et de nouveau après un résumé', () => {
    const session_id = `fichiers-${file}`;
    const read = (extra = {}) =>
      before({ file_path: source }, { session_id, ...extra });
    const states = [
      contextSessionFile(session_id, file),
      contextSessionFile(`${session_id}\0agent`, file),
    ];
    try {
      expect(read()).not.toBeNull();
      expect(read()).toBeNull();
      expect(read({ agent_id: 'agent' })).not.toBeNull();

      const start = (source_: string) =>
        contextHookOutput(
          file,
          JSON.stringify({
            hook_event_name: 'SessionStart',
            session_id,
            source: source_,
          }),
        );
      expect(start('resume')).toBe('');
      expect(read()).toBeNull();
      expect(start('compact')).toBe('');
      expect(read()).not.toBeNull();
    } finally {
      for (const state of states) fs.rmSync(state, { force: true });
    }
  });

  it('cite les nœuds d’un fichier nommé dans la demande, sans le tenir pour lu', () => {
    const ask = (prompt: string) => {
      const output = contextHookOutput(
        file,
        JSON.stringify({
          prompt,
          hook_event_name: 'UserPromptSubmit',
          cwd: root,
        }),
      );
      return output
        ? (
            JSON.parse(output) as {
              hookSpecificOutput: { additionalContext: string };
            }
          ).hookSpecificOutput.additionalContext
        : '';
    };
    for (const name of [
      'src/mcp/server.ts',
      '`src/mcp/server.ts:12`',
      source,
      '(src\\mcp\\server.ts)',
    ])
      expect(ask(`zzz ${name} ?`)).toContain(
        'nœuds qui documentent src/mcp/server.ts',
      );
    expect(ask('zzz src/mcp/absent.ts')).not.toContain('qui documentent');
    expect(ask('/commande src/mcp/server.ts')).toBe('');
    expect(fs.existsSync(readLogFile(file))).toBe(false);
  });
});
