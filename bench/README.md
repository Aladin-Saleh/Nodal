# Bancs de mesure : coût des questions de développement

Suivi, dans le temps, de ce que coûte à Claude Code une question typique sur
ce dépôt **avec Nodal** (serveur MCP, base `Documents\Nodal.nodal`) et
**sans** (aucun serveur MCP : lecture des fichiers). Les mesures de taille des
réponses MCP, outil par outil, restent dans
[docs/benchmark-tokens-mcp.md](../docs/benchmark-tokens-mcp.md).

## Lancer un banc

```sh
npx vite build -c vite.mcp.config.mts   # serveur mesuré : dist/nodal-mcp.cjs
node bench/run-bench.mjs --runs 2 --model sonnet --label "ce qui a changé"
# options : --only ipc,capture   --jobs 4
#           --variants sans-nodal,nodal,nodal-hook,nodal-skill
```

- Chaque run est un `claude -p` neuf, dans une **copie propre du dépôt** par
  variante (dernier commit, donc committer avant) : sans `bench/` (il contient
  les réponses), sans réglages d'assistant ni mémoire, sans `CLAUDE.md` quand
  Nodal est absent. Avant le 24/11/2026, le contexte automatique du projet et
  la mémoire pouvaient aider la variante « sans Nodal ».
- `nodal` : serveur MCP en lecture seule ; `nodal-hook` : avec le contexte
  automatique ; `nodal-skill` : avec le skill en plus.
- Lecture seule : Edit et Write interdits ; base copiée.
- Questions : [questions.json](questions.json), dont une sur une décision, une
  sur les relations et une absente de Nodal (où il ne peut que coûter).
- Variables : `NODAL_BENCH_BASE`, `NODAL_BENCH_SERVER`,
  `NODAL_BENCH_SERVERS='nom=chemin;…'` (autres serveurs à comparer),
  `CLAUDE_BIN`.

Chaque banc écrit `results/<date>.json` (réponses comprises) et `.md`. Compter
0,07 $ par run environ (Sonnet).

## Limites

- Peu de runs : la variance d'un `claude -p` à l'autre est forte (nombre de
  tours, cache). Regarder les tendances, pas le dernier chiffre.
- Qualité : part des faits attendus (`expect` dans `questions.json`) présents
  dans la réponse, notée par `score.mjs` (aussi utilisable seul sur un ancien
  résultat). Indicateur grossier : relire `answer` dans le JSON en cas de doute.
- 2 runs par cas et 6 questions, dont 3 écrites par l'auteur des fiches : des
  ordres de grandeur, pas une preuve.

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

Le 02/11/2026, à chaud : **−77 %** (ipc), **−52 %** (capture),
**−53 %** (avant-modif) de coût par rapport à la lecture des fichiers, avec
une qualité égale ou supérieure (100 % contre 89 à 100 %).

## Banc du 25/11/2026 (Sonnet, dépôt isolé, 6 questions, 2 runs)

Coût à chaud par question, qualité entre parenthèses. « Avant » : serveur avant
les lots. Réponses renotées avec les motifs actuels ; pour chaque case, le
dernier banc (les consignes ont été affinées en route).

| Question               | Sans Nodal    | Avant         | Nodal         | + contexte auto | + skill       |
| ---------------------- | ------------- | ------------- | ------------- | --------------- | ------------- |
| ipc                    | 0,054 (94 %)  | 0,025 (100 %) | 0,015 (100 %) | 0,010 (100 %)   | 0,009 (100 %) |
| capture                | 0,043 (89 %)  | 0,012 (100 %) | 0,022 (100 %) | 0,008 (100 %)   | 0,008 (100 %) |
| avant-modif            | 0,058 (100 %) | 0,039 (100 %) | 0,026 (100 %) | 0,039 (89 %)    | 0,030 (89 %)  |
| pourquoi (décision)    | 0,102 (0 %)   | 0,054 (100 %) | 0,046 (100 %) | 0,011 (70 %)    | 0,024 (90 %)  |
| impact (relations)     | 0,034 (93 %)  | 0,041 (71 %)  | 0,044 (100 %) | 0,010 (71 %)    | 0,009 (71 %)  |
| code-seul (hors Nodal) | 0,010 (100 %) | 0,029 (100 %) | 0,040 (100 %) | 0,026 (100 %)   | 0,011 (100 %) |
| **Moyenne à chaud**    | 0,050 (79 %)  | 0,033 (95 %)  | 0,032 (100 %) | 0,017 (88 %)    | 0,015 (92 %)  |
| Coût, 1er run compris  | 0,087         | 0,066         | 0,076         | 0,064           | 0,059         |
| Tours / durée          | 6,8 / 13 s    | 3,3 / 7 s     | 3,4 / 7 s     | 1,8 / 6 s       | 1,8 / 6 s     |

- Gain surtout sur ce que le code ne dit pas (décision : 0 % sans Nodal).
- Nodal **perd** sur une question de pur code ; le skill l'annule presque.
- Le contexte automatique divise le coût, mais répond parfois sans compléter.
- Charger `nodal_impact` d'emblée n'a rien changé (annulé) ; citer dans la
  recherche les nœuds touchés par le premier résultat : 71-86 → 100 %.

### Ce que les bancs précédents ont montré

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
