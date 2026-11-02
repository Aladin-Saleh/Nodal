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
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const variants = option('variants', 'nodal,sans-nodal').split(',');
const label = option('label', '');
const base =
  process.env.NODAL_BENCH_BASE ??
  path.join(os.homedir(), 'Documents', 'Nodal.nodal');
const server =
  process.env.NODAL_BENCH_SERVER ??
  path.join(os.homedir(), '.nodal', 'mcp-dev', 'nodal-mcp.cjs');

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

// Configurations MCP explicites (--strict-mcp-config) : rien d'autre chargé.
const configs = {
  nodal: {
    mcpServers: {
      nodal: { command: 'node', args: [server, base, '--read-only'] },
    },
  },
  'sans-nodal': { mcpServers: {} },
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodal-bench-'));

/** Outils autorisés : lecture seule, aucune écriture possible. */
const ALLOWED = [
  'Read',
  'Grep',
  'Glob',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(ls:*)',
  'mcp__nodal__nodal_search',
  'mcp__nodal__nodal_get_node',
  'mcp__nodal__nodal_read_document',
  'mcp__nodal__nodal_tree',
  'mcp__nodal__nodal_neighborhood',
  'mcp__nodal__nodal_overview',
  'mcp__nodal__nodal_for_files',
  'mcp__nodal__nodal_path',
  'mcp__nodal__nodal_health',
];

function runOnce(question, variant) {
  const configFile = path.join(tmp, `${variant}.json`);
  fs.writeFileSync(configFile, JSON.stringify(configs[variant]));
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
    'Edit,Write,NotebookEdit',
  ];
  return new Promise((resolve) => {
    const child = spawn(claudeBin, cliArgs, {
      cwd: repo,
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

const results = [];
for (const question of questions) {
  for (const variant of variants) {
    for (let run = 1; run <= runs; run++) {
      process.stderr.write(`${question.id} · ${variant} · run ${run}… `);
      const measured = { ...(await runOnce(question, variant)), run };
      results.push(measured);
      process.stderr.write(
        `${measured.ok ? 'ok' : 'ÉCHEC'} ${measured.turns} tours, ${measured.costUsd?.toFixed(4)} $\n`,
      );
    }
  }
}
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
for (const question of questions) {
  const a = rows.find(
    (r) => r.question === question.id && r.variant === 'nodal',
  );
  const b = rows.find(
    (r) => r.question === question.id && r.variant === 'sans-nodal',
  );
  if (a && b && a.cost && b.cost) {
    table.push(
      `- ${question.id} : coût ${fmt((a.cost / b.cost - 1) * 100)} % (à chaud ${fmt((a.warmCost / b.warmCost - 1) * 100)} %), entrée ${fmt((a.input / b.input - 1) * 100)} % avec Nodal.`,
    );
  }
}
fs.writeFileSync(path.join(outDir, `${stamp}.md`), `${table.join('\n')}\n`);
process.stdout.write(
  `${table.join('\n')}\n\nbench/results/${stamp}.{json,md}\n`,
);
