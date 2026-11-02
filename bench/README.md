# Bancs de mesure : coût des questions de développement

Suivi, dans le temps, de ce que coûte à Claude Code une question typique sur
ce dépôt **avec Nodal** (serveur MCP, base `Documents\Nodal.nodal`) et
**sans** (aucun serveur MCP : lecture des fichiers). Les mesures de taille des
réponses MCP, outil par outil, restent dans
[docs/benchmark-tokens-mcp.md](../docs/benchmark-tokens-mcp.md).

## Lancer un banc

```sh
node bench/run-bench.mjs --runs 2 --label "ce qui a changé"
# options : --only ipc,capture   --variants nodal,sans-nodal
```

- Chaque run est un `claude -p` neuf, lancé depuis la racine du dépôt (le
  `CLAUDE.md` du projet est donc chargé), en `--output-format stream-json`.
- `--strict-mcp-config` : la variante « nodal » ne charge que le serveur Nodal,
  **en lecture seule** (`--read-only`, rien n'est écrit dans la base) ; la
  variante « sans-nodal » ne charge aucun serveur.
- Outils autorisés : lecture seule (Read, Grep, Glob, `git log`, `git show`,
  `ls`, outils de lecture de Nodal) ; Edit et Write interdits.
- Relevé dans l'événement `result` : tours, tokens d'entrée (non cachés + écrits
  en cache + lus en cache), sortie, coût, durée ; outils appelés et réponse
  dans le JSON.
- Questions : [questions.json](questions.json). Les garder stables pour
  comparer les bancs ; en ajouter plutôt qu'en modifier.
- Variables : `NODAL_BENCH_BASE` (fichier .nodal), `NODAL_BENCH_SERVER`
  (bundle du serveur, par défaut `~/.nodal/mcp-dev/nodal-mcp.cjs`),
  `CLAUDE_BIN`.

Chaque banc écrit `results/<date>.json` (détail, réponses comprises) et
`results/<date>.md` (tableau). Le coût d'un banc complet (3 questions ×
2 variantes × 2 runs) est de l'ordre de 3 à 4 $.

## Limites

- Peu de runs : la variance d'un `claude -p` à l'autre est forte (nombre de
  tours, cache). Regarder les tendances, pas le dernier chiffre.
- Qualité : part des faits attendus (`expect` dans `questions.json`) présents
  dans la réponse, notée par `score.mjs` (aussi utilisable seul sur un ancien
  résultat). Indicateur grossier : relire `answer` dans le JSON en cas de doute.
- La variante « sans-nodal » lit le `CLAUDE.md`, qui demande de consulter
  Nodal : l'assistant constate l'absence du serveur puis lit les fichiers,
  comme dans une session où Nodal ne répond pas.

## Historique

Coût moyen **à chaud** (runs ≥ 2, cache déjà écrit) par question, en dollars,
nombre de tours et qualité (faits attendus présents, moyenne des runs). Le
premier run d'une série coûte de 0,10 à 0,30 $ de plus (écriture du cache) :
il n'est pas comparé.

| Date             | Variante / changement                                                | ipc                  | capture              | avant-modif          | Détail                                 |
| ---------------- | -------------------------------------------------------------------- | -------------------- | -------------------- | -------------------- | -------------------------------------- |
| 2026-11-01 14:38 | **Sans Nodal** (lecture des fichiers)                                | 0,221 · 8 t. · 89 %  | 0,109 · 7 t. · 94 %  | 0,097 · 5 t. · 100 % | [143833](results/2026-11-01T143833.md) |
| 2026-11-01 14:38 | Nodal rebranché, base complétée (recettes, groupes C et D, ancrages) | 0,042 · 3 t. · 67 %  | 0,149 · 3 t. · 61 %  | 0,204 · 6 t. · 89 %  | [143833](results/2026-11-01T143833.md) |
| 2026-11-01 14:40 | `nodal_for_files` chargé d'emblée, consigne « en parallèle »         |                      |                      | 0,065 · 4 t. · 89 %  | [144037](results/2026-11-01T144037.md) |
| 2026-11-01 14:44 | `nodal_get_node` et `nodal_read_document` chargés d'emblée           | 0,029 · 3 t. · 67 %  | 0,025 · 3 t. · 61 %  | 0,067 · 4 t. · 89 %  | [144407](results/2026-11-01T144407.md) |
| 2026-11-02 12:31 | Base enrichie (mécanismes exacts) + consigne « le code fait foi »    | 0,051 · 3 t. · 100 % | 0,052 · 3 t. · 100 % | 0,045 · 4 t. · 100 % | [123145](results/2026-11-02T123145.md) |

État actuel avec Nodal, à chaud : **−77 %** (ipc), **−52 %** (capture),
**−53 %** (avant-modif) de coût par rapport à la lecture des fichiers, avec
une qualité égale ou supérieure (100 % contre 89 à 100 %).

### Ce que les bancs ont montré

- Le coût suit le nombre de tours (chaque tour renvoie environ 25 000 tokens
  de contexte), bien plus que la taille des réponses de Nodal (moins de
  2 000 caractères ici).
- Un outil MCP non chargé d'emblée coûte un tour `ToolSearch` à son premier
  usage : `nodal_get_node`, `nodal_read_document` et `nodal_for_files` sont
  désormais chargés comme `nodal_search` (`anthropic/alwaysLoad`), pour
  quelques centaines de tokens de définition, lus depuis le cache.
- Avant la base complétée, Nodal ne répondait pas du tout (serveur 1.3.0
  face à une base au schéma 10) : tout passait par la lecture des sources.
  `results/2026-11-01T144127` : diagnostic d'un run « capture » (appels et
  taille des réponses).
- La qualité a d'abord baissé (61 à 89 %) : la base décrivait les
  mécanismes moins précisément que le code. Corrigé en enregistrant les
  détails dont dépendent les réponses (vérification de l'émetteur,
  `ID_FIELDS`…) et par une consigne : « Nodal décrit, le code fait foi », un
  détail d'implémentation se vérifie par une lecture ciblée (un `Grep`). Coût
  de la qualité retrouvée : environ +0,02 $ par question à chaud sur ipc et
  capture, toujours bien moins cher que sans Nodal.
- Un banc doit toujours regarder coût **et** qualité : le banc de 14:44 était
  le moins cher, mais le moins juste.
