#!/usr/bin/env node
/**
 * Note la qualité des réponses d'un ou plusieurs bancs : part des faits
 * attendus (bench/questions.json, champ `expect`, expressions régulières
 * sans casse) présents dans chaque réponse. Usage :
 *   node bench/score.mjs bench/results/<date>.json [...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const questions = JSON.parse(
  fs.readFileSync(path.join(here, 'questions.json'), 'utf8'),
);

/** Faits trouvés / attendus pour une réponse. */
export function scoreAnswer(questionId, answer) {
  const expected = questions.find((q) => q.id === questionId)?.expect ?? [];
  const missing = expected.filter(
    (pattern) => !new RegExp(pattern, 'i').test(answer ?? ''),
  );
  return {
    found: expected.length - missing.length,
    total: expected.length,
    missing,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const file of process.argv.slice(2)) {
    const { meta, results } = JSON.parse(fs.readFileSync(file, 'utf8'));
    process.stdout.write(`# ${path.basename(file)} — ${meta.label}\n`);
    for (const r of results) {
      const s = scoreAnswer(r.question, r.answer);
      process.stdout.write(
        `${r.question} · ${r.variant} · run ${r.run} : ${s.found}/${s.total}` +
          (s.missing.length ? ` (manque : ${s.missing.join(', ')})` : '') +
          '\n',
      );
    }
  }
}
