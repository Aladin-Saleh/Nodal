# Benchmark : coût en tokens des réponses du serveur MCP

Mesures du 30 octobre 2026. L'objectif était de vérifier ce que le format TOON
rapporte réellement par rapport au JSON, et de trouver où partent les tokens
des réponses que le serveur MCP envoie au LLM.

## Résumé

- **TOON seul fait gagner 5 à 20 %** par rapport au JSON compact. Les 30 à
  47 % souvent annoncés comparent TOON à du JSON indenté, qu'aucun outil n'a de
  raison d'envoyer.
- **Les UUID étaient le principal poste de coût** : 69 % des tokens de
  l'arborescence. Chaque UUID coûte environ 23 tokens, parce que de
  l'hexadécimal aléatoire se découpe mal.
- **Avec des identifiants courts et sans `parentId` dans l'arborescence**, les
  réponses coûtent **35 à 69 % de moins qu'en JSON compact** et 31 à 62 % de
  moins qu'avec la première version TOON.

## Méthode

- **Tokenizer** : `o200k_base` (js-tiktoken 1.0.21), le même que pour l'export
  LLM. Le tokenizer de Claude n'est pas public : les proportions devraient être
  proches, mais elles n'ont pas été vérifiées.
- **Espace de test** généré de façon reproductible :
  - échelle ×1 : 10 racines × 6 composants × 4 éléments = **310 nœuds**,
    60 résumés, 60 documents Markdown, 5 tags, jusqu'à 400 relations (doublons
    ignorés, un libellé sur trois) ;
  - échelle ×10 : **3 100 nœuds**, 600 documents, jusqu'à 4 000 relations,
    soit environ 7 700 identifiants.
- **Appels mesurés** :
  - `nodal_overview` ;
  - `nodal_tree` avec `depth: 5` et `maxRows: 2000`, donc tout l'espace ;
  - `nodal_search` avec `query: "domaine"` et `limit: 20` ;
  - `nodal_get_node` sur un composant ;
  - `nodal_neighborhood` avec `depth: 2` depuis ce même composant.
- **Variantes comparées**, calculées à partir des mêmes données :
  - JSON compact (`JSON.stringify` sans indentation) ;
  - JSON indenté (`JSON.stringify(data, null, 2)`) ;
  - TOON avec UUID complets (première version du serveur) ;
  - TOON avec identifiants courts, sans `parentId` dans l'arborescence
    (version actuelle).
- La colonne « Maintenant » compte les tokens des **réponses réellement
  servies**, obtenues par le protocole MCP (`tools/call`) : il ne s'agit pas
  d'une estimation.

## Résultats

### Échelle ×1 (310 nœuds)

| Outil                | JSON compact | TOON (avant) | Maintenant | Gain / JSON | Gain / TOON avant |
| -------------------- | -----------: | -----------: | ---------: | ----------: | ----------------: |
| `nodal_overview`     |          654 |          533 |        358 |       −45 % |             −33 % |
| `nodal_tree`         |       24 610 |       20 288 |      7 710 |   **−69 %** |             −62 % |
| `nodal_search`       |        2 628 |        2 112 |      1 398 |       −47 % |             −34 % |
| `nodal_get_node`     |          521 |          494 |        341 |       −35 % |             −31 % |
| `nodal_neighborhood` |        2 719 |        2 350 |      1 017 |   **−63 %** |             −57 % |

### Échelle ×10 (3 100 nœuds)

| Outil                | JSON compact | TOON (avant) | Maintenant | Gain / JSON | Gain / TOON avant |
| -------------------- | -----------: | -----------: | ---------: | ----------: | ----------------: |
| `nodal_overview`     |        4 813 |        3 846 |      2 060 |       −57 % |             −46 % |
| `nodal_tree`         |      159 191 |      131 089 |     49 579 |   **−69 %** |             −62 % |
| `nodal_search`       |        1 336 |          983 |        641 |       −52 % |             −35 % |
| `nodal_get_node`     |          583 |          540 |        351 |       −40 % |             −35 % |
| `nodal_neighborhood` |        2 939 |        2 503 |        962 |   **−67 %** |             −62 % |

Les résultats de `nodal_search` ne se comparent pas d'une échelle à l'autre :
la même requête ne renvoie pas les mêmes nœuds ni le même nombre d'extraits.

### Première mesure : TOON face au JSON (UUID complets)

| Outil                     |   TOON | JSON compact | JSON indenté | Gain / JSON compact | Gain / JSON indenté |
| ------------------------- | -----: | -----------: | -----------: | ------------------: | ------------------: |
| `nodal_overview`          |    538 |          664 |        1 023 |                19 % |                47 % |
| `nodal_tree` (300 lignes) | 19 729 |       23 952 |       31 450 |                18 % |                37 % |
| `nodal_search`            |  2 141 |        2 663 |        3 343 |                20 % |                36 % |
| `nodal_get_node`          |    494 |          522 |          695 |                 5 % |                29 % |
| `nodal_neighborhood`      |  2 399 |        2 776 |        3 487 |                14 % |                31 % |

Dans cette sortie de `nodal_tree`, les 590 UUID représentaient
**13 523 tokens sur 19 729 (69 %)**.

## D'où vient le gain

Décomposition pour `nodal_tree`, l'appel le plus coûteux :

| Étape                       | Échelle ×1 | Échelle ×10 |
| --------------------------- | ---------: | ----------: |
| JSON compact, UUID complets |     24 610 |     159 191 |
| TOON au lieu de JSON        |     −4 322 |     −28 102 |
| Identifiants courts         |    −10 925 |     −70 567 |
| Retrait de `parentId`       |     −1 666 |     −10 941 |
| **Résultat**                |  **7 697** |  **49 581** |

Avec ou sans identifiants courts, TOON fait gagner exactement le même nombre de
tokens (4 322 à l'échelle ×1). Ce gain vient du fait que les noms de champs ne
sont plus répétés à chaque ligne, et il ne dépend pas de la valeur des champs.
Sur des réponses plus courtes, son poids relatif augmente : −32 % par rapport
au JSON quand les identifiants sont courts.

Le résultat de la décomposition (7 697) diffère légèrement de la réponse servie
(7 710). Les UUID sont aléatoires d'une exécution à l'autre, et TOON met entre
guillemets un préfixe qui ressemble à un nombre (`12345678`, `1e345678`).

## Choix faits dans le serveur

- **Identifiants courts** (`src/mcp/short-ids.ts`) :
  - le serveur affiche le plus court préfixe unique de chaque UUID, avec
    8 caractères au minimum, allongé seulement en cas de ressemblance (par
    exemple `abcdef01-1`) ;
  - les préfixes sont calculés sur tous les identifiants de l'espace (nœuds,
    documents, relations, pièces jointes) ;
  - les outils acceptent en entrée un préfixe ou un UUID complet ; un préfixe
    ambigu est refusé avec un message explicite ;
  - la base et l'application gardent les UUID complets.
  - Même à l'échelle ×10, aucun préfixe n'a dû être allongé.
- **`nodal_tree` sans `parentId`** : l'ordre des lignes (parcours en
  profondeur) et la profondeur suffisent à reconstruire l'arbre.
- **Ce qui n'a pas été retenu** : des alias par session (`n1`, `n2`…), qui ne
  coûtent qu'un ou deux tokens. Un alias ne vaut que pendant la vie du serveur,
  et un LLM qui garde un identifiant d'une conversation à l'autre se
  tromperait.

## Évolution : vue d'ensemble enrichie

Depuis ces mesures, `nodal_overview` donne aussi les nœuds les plus reliés,
l'activité récente (10 lignes chacune), le nombre de descendants des racines
et la part créée par l'assistant. Coût mesuré de la même façon :

| Espace      | Avant | Après | dont racines | dont nœuds reliés | dont activité récente |
| ----------- | ----: | ----: | -----------: | ----------------: | --------------------: |
| 310 nœuds   |   358 | 1 197 |          231 |               327 |                   465 |
| 3 100 nœuds | 2 060 | 3 049 |        2 086 |               324 |                   463 |

Le surcoût est fixe (environ 800 à 1 000 tokens), car les deux nouvelles
rubriques sont limitées à 10 lignes. Il se paie en général une fois par
session et doit éviter au LLM d'explorer l'arborescence pour s'orienter ;
cette économie-là n'a pas été mesurée.

## Coût de bout en bout d'une consultation

Mesures du 30 octobre 2026 dans Claude Code (`claude -p --output-format
stream-json --verbose`, `--strict-mcp-config` pour que les deux serveurs
soient chargés de la même façon), sur une question à deux volets : « Quelles
migrations SQLite existe-t-il dans Nodal, et pourquoi le serveur MCP est-il
exécuté par Node plutôt que par l'exécutable Electron ? ». Moyennes des runs 2
et 3 (le premier paie l'écriture du cache) :

| Variante                      | Tours | Entrée (tokens) | Sortie |     Coût |
| ----------------------------- | ----: | --------------: | -----: | -------: |
| Sans Nodal (README + sources) |     4 |        ~124 000 | ~1 060 | ~0,072 $ |
| Nodal 1.1.0                   |     7 |        ~165 700 |   ~845 | ~0,079 $ |
| Nodal, recherche avec contenu |     3 |         ~68 800 |   ~543 | ~0,025 $ |

Chaque tour renvoie tout le contexte de base (environ 23 000 tokens) : le
coût suit le nombre de tours bien plus que la taille des réponses. Avec la
version 1.1.0, une consultation enchaînait `ToolSearch` (Claude Code charge
les outils MCP à la demande), `nodal_search` pour trouver, puis
`nodal_read_document` pour lire : 7 tours, plus cher que de lire le README.

D'où trois changements :

- `nodal_search` renvoie le résumé des nœuds trouvés et le contenu des
  documents trouvés, dans un budget (`maxChars`, 12 000 caractères par
  défaut) ; les documents hors budget sont cités par un extrait ;
- `nodal_search` porte `_meta: { "anthropic/alwaysLoad": true }` : Claude Code
  le charge d'emblée, sans tour `ToolSearch` ;
- les consignes (serveur, bloc CLAUDE.md) font commencer par `nodal_search`,
  avec des recherches parallèles pour une question à plusieurs volets, et
  réservent `nodal_overview` aux questions vagues.

Résultat : deux recherches parallèles puis la réponse, soit −58 % en entrée,
−36 % en sortie et −69 % de coût par rapport à la 1.1.0, et −66 % de coût par
rapport à la lecture des fichiers, pour une réponse aussi complète.

## Réponses ciblées : sections, détail d'un nœud, consignes

Mesures du 30 octobre 2026, même méthode (réponses réellement servies par
`tools/call`, tokenizer `o200k_base`), sur deux espaces :

- **réel** : copie de la base Nodal de ce projet (une vingtaine de nœuds,
  documents de quelques centaines à 5 000 caractères) ;
- **synthétique** : 12 nœuds, chacun avec une « Fiche technique » Markdown
  d'environ 13 000 caractères en 8 sections et une courte note.

Changements mesurés :

- `nodal_search` renvoie un document court (moins de 2 000 caractères) en
  entier, et d'un long document **seulement les sections qui contiennent le
  plus de mots cherchés** (découpage de `chunking.ts` : titres Markdown,
  blocs de code, clés JSON), chacune avec son `offset` pour lire la suite ;
- `nodal_get_node` inclut le contenu des documents courts (6 000 caractères
  au plus) et la taille (`chars`) de chaque document ;
- consignes : le mode d'emploi des outils est dans les consignes du serveur,
  raccourcies ; le bloc CLAUDE.md ne fait plus que déclencher la
  consultation. Les consignes du serveur parviennent à tout client MCP sans
  rien configurer ; le bloc CLAUDE.md sert seulement à faire consulter Nodal
  avant les fichiers. Les deux sont envoyés à chaque tour : le détail en
  double coûtait deux fois.

| Mesure (tokens)                               | Avant | Après |           Écart |
| --------------------------------------------- | ----: | ----: | --------------: |
| Consignes du serveur (envoyées à chaque tour) |   472 |   283 |           −40 % |
| Bloc CLAUDE.md (envoyé à chaque tour)         |   254 |   114 |           −55 % |
| Réel : 4 recherches                           | 7 332 | 4 318 |           −41 % |
| Réel : `nodal_get_node` ×3                    |   894 | 1 593 |           +78 % |
| Synthétique : « rollout canari »              | 3 039 | 3 050 |             0 % |
| Synthétique : « Facturation déploiement »     |   152 |   502 | voir ci-dessous |
| Synthétique : « Kafka PostgreSQL »            | 2 998 | 3 123 |            +4 % |

Lecture :

- **Consignes** : environ 330 tokens de moins **à chaque tour**, le gain le
  plus sûr.
- **Recherche sur la base réelle** : −41 %, pour des réponses qui contiennent
  toujours les passages utiles.
- **Documents longs** : à budget égal, le contenu change de nature. Avant,
  « rollout canari » renvoyait le début d'une seule fiche, tronquée à
  12 000 caractères ; maintenant, la section « Déploiement » de chacune des
  fiches qui en parlent.
- **Correctif** : avant, « Facturation déploiement » ne renvoyait **pas** la
  section pertinente. La courte note, mieux classée, passait d'abord, et la
  longue fiche ne tenait plus dans le budget restant : elle était réduite à
  un extrait. Les 502 tokens d'après contiennent la note et la section
  « Déploiement » de la fiche.
- **`nodal_get_node`** coûte plus cher, mais il inclut le contenu des
  documents courts : un appel `nodal_read_document` de moins, donc un tour
  (environ 23 000 tokens de contexte) de moins quand il fallait lire.
- « Kafka PostgreSQL » : les deux mots sont dans tous les paragraphes de
  l'espace synthétique, toutes les sections sont à égalité ; le budget borne
  la réponse comme avant.

De bout en bout (`claude -p`, `--strict-mcp-config`, copie de la base réelle,
CLAUDE.md de chaque version, deux runs par question, tokens d'entrée) :

| Question                           |  Avant |  Après |  Écart | Appels (avant et après) |
| ---------------------------------- | -----: | -----: | -----: | ----------------------- |
| Migrations SQLite + pourquoi Node  | 71 058 | 65 954 | −7,2 % | 2 × `nodal_search`      |
| Persistance des réglages du graphe | 64 534 | 63 486 | −1,6 % | 1 × `nodal_search`      |

Le nombre de tours ne change pas (2 et 3, déjà au minimum depuis la 1.2) :
le gain vient des consignes et de réponses plus courtes. Les réponses sont
aussi complètes qu'avant. Le coût en dollars n'est pas comparé : il dépend
surtout de l'écriture ou de la relecture du cache entre les runs.

## Limites

- Seule la taille des réponses a été mesurée, pas la qualité des réponses du
  LLM. Des identifiants plus courts devraient plutôt réduire les erreurs de
  recopie, mais ce n'est pas démontré. TOON n'a pas non plus été évalué sur la
  compréhension : nos données sont des tables plates, le cas où il est le plus
  lisible, mais le JSON reste plus familier aux modèles.
- Le tokenizer mesuré est `o200k_base`, pas celui de Claude.
- L'espace de test est synthétique : titres courts, résumés d'une phrase. Avec
  des titres et des résumés plus longs, la part des identifiants baisse, et le
  gain relatif des identifiants courts avec elle.
- L'arborescence complète d'un gros espace reste lourde (environ 50 000 tokens
  pour 3 100 nœuds). La limite par défaut de 300 lignes la plafonne, et c'est
  au LLM de demander des sous-arbres (`rootId`, `depth`).
