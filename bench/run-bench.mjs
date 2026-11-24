#!/usr/bin/env node
/**
 * Banc de mesure de bout en bout : coût d'une question de développement
 * posée à Claude Code sur ce dépôt, avec Nodal (serveur MCP en lecture
 * seule) et sans aucun serveur MCP. Chaque run est un `claude -p` neuf ;
 * le résultat (tours, tokens, coût, outils appelés, réponse) est relevé
 * dans l'événement `result` du flux stream-json.
 *
 * Usage : node bench/run-bench.mjs [--runs 2] [--only ipc,capture]
 *         [--variants nodal,sans-nodal] [--label "texte libre"]
 *
 * Variables : NODAL_BENCH_BASE (fichier .nodal, par défaut
 * ~/Documents/Nodal.nodal), NODAL_BENCH_SERVER (bundle du serveur, par
 * défaut ~/.nodal/mcp-dev/nodal-mcp.cjs).
 *
 * Écrit bench/results/<date>.json (détail) et <date>.md (tableau).
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { scoreAnswer } from './score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};

const runs = Number(option('runs', '2'));
const only = option('only', null)?.split(',');
const variants = option('variants', 'sans-nodal,nodal').split(',');
const label = option('label', '');
const model = option('model', null);
const jobs = Number(option('jobs', '3'));
const base =
  process.env.NODAL_BENCH_BASE ??
  path.join(os.homedir(), 'Documents', 'Nodal.nodal');
const defaultServer =
  process.env.NODAL_BENCH_SERVER ?? path.join(repo, 'dist', 'nodal-mcp.cjs');

// Exécutable natif appelé sans shell : les arguments ne sont jamais réinterprétés.
const nativeClaude = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
const claudeBin =
  process.env.CLAUDE_BIN ??
  (process.platform === 'win32' && fs.existsSync(nativeClaude)
    ? nativeClaude
    : 'claude');

const questions = JSON.parse(
  fs.readFileSync(path.join(here, 'questions.json'), 'utf8'),
).filter((q) => !only || only.includes(q.id));

/**
 * Variantes. `server` : bundle du serveur MCP ; `hook` : contexte automatique ;
 * `skill` : skill installé dans le projet. D'autres serveurs peuvent être
 * comparés par NODAL_BENCH_SERVERS='nom=chemin;nom=chemin'.
 */
const VARIANTS = {
  'sans-nodal': { server: null, hook: false, skill: false },
  nodal: { server: defaultServer, hook: false, skill: false },
  'nodal-hook': { server: defaultServer, hook: true, skill: false },
  'nodal-skill': { server: defaultServer, hook: true, skill: true },
};
for (const pair of (process.env.NODAL_BENCH_SERVERS ?? '').split(';')) {
  const at = pair.indexOf('=');
  if (at > 0) {
    VARIANTS[pair.slice(0, at)] = {
      server: pair.slice(at + 1),
      hook: false,
      skill: false,
    };
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodal-bench-'));
const git = (...gitArgs) =>
  execFileSync('git', gitArgs, { cwd: repo, encoding: 'utf8' });

/**
 * Projet propre à une variante, pour ne rien laisser passer d'une autre :
 * copie des fichiers suivis (dernier commit), sans `bench/` (il contient les
 * réponses attendues) ni réglages d'assistant ; le CLAUDE.md, qui demande de
 * consulter Nodal, seulement quand Nodal est là. Le dossier étant nouveau,
 * l'assistant n'y a pas non plus de mémoire.
 */
function prepare(name) {
  const variant = VARIANTS[name];
  if (!variant) throw new Error(`Variante inconnue : ${name}`);
  const project = path.join(tmp, name, 'Nodal');
  fs.mkdirSync(project, { recursive: true });
  const archive = path.join(tmp, `${name}.tar`);
  git('archive', '-o', archive, 'HEAD');
  execFileSync('tar', ['-xf', path.basename(archive), '-C', `${name}/Nodal`], {
    cwd: tmp,
  });
  for (const item of ['bench', '.claude', 'docs/benchmark-tokens-mcp.md'])
    fs.rmSync(path.join(project, item), { recursive: true, force: true });
  if (!variant.server) fs.rmSync(path.join(project, 'CLAUDE.md'));
  // Dépôt à part : Claude Code y voit un projet, sans l'historique.
  execFileSync('git', ['init', '-q'], { cwd: project });

  const mcpServers = {};
  if (variant.server) {
    const copy = path.join(tmp, `${name}.nodal`);
    new DatabaseSync(base, { readOnly: true }).exec(
      `VACUUM INTO '${copy.replaceAll("'", "''")}'`,
    );
    const db = new DatabaseSync(copy);
    db.prepare(
      "UPDATE workspace_settings SET value = ? WHERE key = 'code.roots'",
    ).run(JSON.stringify([project]));
    db.close();
    mcpServers.nodal = {
      command: 'node',
      args: [variant.server, copy, '--read-only'],
    };
    if (variant.hook) {
      const command = `node "${variant.server}" "${copy}" --context`;
      const hooks = [{ type: 'command', command, timeout: 10 }];
      fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(project, '.claude', 'settings.json'),
        JSON.stringify({
          hooks: {
            UserPromptSubmit: [{ hooks }],
            PreToolUse: [{ matcher: 'Read|Edit|Write|Bash', hooks }],
          },
        }),
      );
    }
    if (variant.skill) {
      fs.cpSync(
        path.join(repo, 'assets', 'skills'),
        path.join(project, '.claude', 'skills'),
        { recursive: true },
      );
    }
  }
  const config = path.join(tmp, `${name}.json`);
  fs.writeFileSync(config, JSON.stringify({ mcpServers }));
  return { project, config };
}
const prepared = new Map(variants.map((name) => [name, prepare(name)]));

/** Outils autorisés : lecture seule, aucune écriture possible. */
const ALLOWED = [
  'Read',
  'Grep',
  'Glob',
  'Skill',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(grep:*)',
  'mcp__nodal',
];

function runOnce(question, variant) {
  const { project, config: configFile } = prepared.get(variant);
  const cliArgs = [
    '-p',
    question.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--mcp-config',
    configFile,
    '--allowedTools',
    ALLOWED.join(','),
    '--disallowedTools',
    'Edit,Write,NotebookEdit,Task,WebSearch,WebFetch',
    ...(model ? ['--model', model] : []),
  ];
  return new Promise((resolve) => {
    const child = spawn(claudeBin, cliArgs, {
      cwd: project,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buffer = '';
    const tools = {};
    const calls = [];
    let result = null;
    const onLine = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'assistant') {
        for (const part of event.message?.content ?? []) {
          if (part.type === 'tool_use') {
            tools[part.name] = (tools[part.name] ?? 0) + 1;
            calls.push({ id: part.id, name: part.name, input: part.input });
          }
        }
      } else if (event.type === 'user') {
        // Taille des réponses d'outils (caractères), pour voir ce qui pèse.
        for (const part of event.message?.content ?? []) {
          if (part.type !== 'tool_result') continue;
          const call = calls.find((c) => c.id === part.tool_use_id);
          const content = Array.isArray(part.content)
            ? part.content.map((c) => c.text ?? '').join('')
            : String(part.content ?? '');
          if (call) call.resultChars = content.length;
        }
      } else if (event.type === 'result') {
        result = event;
      }
    };
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach(onLine);
    });
    child.stderr.on('data', () => undefined);
    child.on('close', () => {
      onLine(buffer);
      const usage = result?.usage ?? {};
      resolve({
        question: question.id,
        variant,
        ok: Boolean(result) && !result.is_error,
        turns: result?.num_turns ?? null,
        costUsd: result?.total_cost_usd ?? null,
        durationMs: result?.duration_ms ?? null,
        inputTokens: usage.input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        tools,
        calls: calls.map(({ id: _id, ...call }) => call),
        answer: result?.result ?? null,
      });
    });
  });
}

// Runs d'un même cas à la suite (le cache du premier sert aux suivants) ;
// plusieurs cas à la fois.
const cases = questions.flatMap((question) =>
  variants.map((variant) => ({ question, variant })),
);
const results = [];
let nextCase = 0;
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (nextCase < cases.length) {
      const { question, variant } = cases[nextCase++];
      for (let run = 1; run <= runs; run++) {
        const measured = { ...(await runOnce(question, variant)), run };
        results.push(measured);
        process.stderr.write(
          `${question.id} · ${variant} · run ${run} : ${measured.ok ? 'ok' : 'ÉCHEC'} ${measured.turns} tours, ${measured.costUsd?.toFixed(4)} $\n`,
        );
      }
    }
  }),
);
fs.rmSync(tmp, { recursive: true, force: true });

// --- Synthèse ----------------------------------------------------------------

const totalInput = (r) =>
  r.inputTokens + r.cacheWriteTokens + r.cacheReadTokens;
const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN;

const rows = [];
for (const question of questions) {
  const byVariant = {};
  for (const variant of variants) {
    const ok = results.filter(
      (r) => r.question === question.id && r.variant === variant && r.ok,
    );
    byVariant[variant] = {
      runs: ok.length,
      turns: mean(ok.map((r) => r.turns)),
      input: mean(ok.map(totalInput)),
      output: mean(ok.map((r) => r.outputTokens)),
      cost: mean(ok.map((r) => r.costUsd)),
      // Le 1er run écrit le cache (environ 30 000 tokens) : à chaud = runs ≥ 2.
      warmCost: mean(ok.filter((r) => r.run >= 2).map((r) => r.costUsd)),
      // Qualité : part des faits attendus présents dans la réponse.
      quality: mean(
        ok.map((r) => {
          const s = scoreAnswer(r.question, r.answer);
          return s.total ? s.found / s.total : NaN;
        }),
      ),
    };
    rows.push({ question: question.id, variant, ...byVariant[variant] });
  }
}

const stamp = new Date().toISOString().replace(/[:]/g, '').replace(/\..*$/, '');
const outDir = path.join(here, 'results');
fs.mkdirSync(outDir, { recursive: true });
const meta = {
  date: new Date().toISOString(),
  label,
  claudeCode: await new Promise((resolve) => {
    const child = spawn(claudeBin, ['--version']);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => resolve(out.trim()));
  }),
  commit: await new Promise((resolve) => {
    const child = spawn('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => resolve(out.trim()));
  }),
  runsPerCase: runs,
  model,
};
fs.writeFileSync(
  path.join(outDir, `${stamp}.json`),
  `${JSON.stringify({ meta, rows, results }, null, 2)}\n`,
);

const fmt = (n, digits = 0) =>
  Number.isNaN(n)
    ? '—'
    : n.toLocaleString('fr-FR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
const table = [
  `# Banc ${meta.date.slice(0, 16).replace('T', ' ')}${label ? ` — ${label}` : ''}`,
  '',
  `Commit ${meta.commit}, ${meta.claudeCode}, ${runs} run(s) par cas (moyennes des runs réussis).`,
  '',
  '| Question | Variante | Runs | Tours | Entrée (tokens) | Sortie | Coût ($) | À chaud ($) | Qualité |',
  '| -------- | -------- | ---: | ----: | --------------: | -----: | -------: | ----------: | ------: |',
  ...rows.map(
    (r) =>
      `| ${r.question} | ${r.variant} | ${r.runs} | ${fmt(r.turns, 1)} | ${fmt(r.input)} | ${fmt(r.output)} | ${fmt(r.cost, 4)} | ${fmt(r.warmCost, 4)} | ${fmt(r.quality * 100)} % |`,
  ),
  '',
];
const reference = variants[0];
table.push(
  '| Variante | Coût moyen ($) | Écart | Tours | Durée (s) | Qualité |',
  '| -------- | -------------: | ----: | ----: | --------: | ------: |',
);
const summary = (variant) => {
  const ok = results.filter((r) => r.variant === variant && r.ok);
  const quality = rows.filter((r) => r.variant === variant);
  return {
    // Moyenne des questions, chacune comptant autant.
    cost: mean(quality.map((r) => r.cost)),
    turns: mean(quality.map((r) => r.turns)),
    seconds: mean(ok.map((r) => r.durationMs)) / 1000,
    quality: mean(quality.map((r) => r.quality)),
  };
};
for (const variant of variants) {
  const s = summary(variant);
  const gap = (s.cost / summary(reference).cost - 1) * 100;
  table.push(
    `| ${variant} | ${fmt(s.cost, 4)} | ${variant === reference ? '—' : `${fmt(gap)} %`} | ${fmt(s.turns, 1)} | ${fmt(s.seconds)} | ${fmt(s.quality * 100)} % |`,
  );
}
fs.writeFileSync(path.join(outDir, `${stamp}.md`), `${table.join('\n')}\n`);
process.stdout.write(
  `${table.join('\n')}\n\nbench/results/${stamp}.{json,md}\n`,
);
