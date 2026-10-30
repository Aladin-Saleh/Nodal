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
