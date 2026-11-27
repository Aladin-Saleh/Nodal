---
name: nodal-scan
description: Documenter dans Nodal une ressource entière (dépôt, dossier de code, documentation), ou reprendre ce travail ; un même espace peut en réunir plusieurs - fait tout - architecture, modules, JSON Schema et exemples JSON, schémas Mermaid, inventaires CSV, extraits de code, procédures, décisions, règles, risques, relations prouvées. À utiliser seulement quand l'utilisateur demande de documenter tout son projet ou son code dans Nodal (long).
argument-hint: '[rapide | complet] [dossiers ou fichiers]'
---

<!-- Installé par Nodal : remplacé à chaque installation. -->

# Documenter une ressource

Demande : $ARGUMENTS

Lisez d'abord `../nodal/conventions.md` (chemin relatif au dossier de ce skill). `rapide` (seulement si demandé) : étapes 1, 2, 3 et 6. Sinon **tout** : l'utilisateur ne doit avoir à lancer aucun autre skill ensuite. Ressource : le dossier courant, ou ce que la demande nomme (sous-dossier, autre dépôt, documentation, fichiers) ; plusieurs : l'une après l'autre. Une documentation sans code : lisez-la comme source, modules = sujets, contrats et schémas seulement s'il y en a.

## Ce que le scan doit produire

Passez chaque ligne en revue. Elle est produite, ou notée `sans objet` avec sa raison (« aucune base de données ») : jamais oubliée, jamais remplie pour la forme.

| À produire                                                                                                                                | Document                |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Vue d'ensemble ; « Fonctionnement » de chaque module                                                                                      | `markdown`              |
| Vue des modules ; séquence des 1 à 3 parcours principaux                                                                                  | `mermaid`               |
| Modèle de données (`erDiagram`), états (`stateDiagram-v2`), types clés (`classDiagram`)                                                   | `mermaid`               |
| Décision complexe : `flowchart` avec losanges                                                                                             | `mermaid`               |
| Contrats : schéma d'entrée, schéma de sortie, exemple de chacun, exemple d'erreur                                                         | `json`                  |
| Fichiers de configuration : schéma et exemple fictif                                                                                      | `json`                  |
| Inventaires : routes ou canaux, commandes, événements, variables d'environnement, tables                                                  | `csv`                   |
| Inventaires : dépendances principales (nom, version, rôle), erreurs (code, cause, traitement), tests (suite, ce qu'elle couvre, commande) | `csv`                   |
| Signature, requête ou exemple d'appel de chaque interface publique importante (repris des tests)                                          | `code`                  |
| Procédures, décisions, règles, risques, dettes, rôles, services externes                                                                  | nœuds typés, `template` |
| Relations prouvées, ancrages, tags                                                                                                        | `link`, `anchor`, `tag` |
| Vues du graphe : 3 à 6 lectures utiles (architecture, module central, décisions et règles, risques et dettes)                             | `view`                  |

## 1. État des lieux

En parallèle : `nodal_overview`, `nodal_tree` (depth 3), et dans le dépôt : fichiers suivis par git (comptes par dossier et extension si la liste est longue), README, manifestes (package.json, pyproject, Cargo.toml, go.mod, pom, csproj…), points d'entrée, CI, documentation et ADR existants, 30 derniers commits. Pas de dépôt git : listez les fichiers.

Écartez : dépendances, fichiers générés, binaires, sorties de construction, fichiers de verrouillage, secrets.

L'espace est vide, ou contient déjà d'autres ressources :

- Le nœud « Couverture : nom de cette ressource » existe : c'est une reprise. Lisez son document « Couverture » et continuez aux lignes `à faire`. Tout est `fait` : dites-le et proposez `nodal-maj`.
- La ressource est une partie d'une racine existante (sous-dossier) : complétez sous cette racine.
- Sinon : nouvelle racine. Ne touchez pas aux autres ; reliez-leur seulement ce que le code prouve (un client `consomme` l'API de l'autre…).

## 2. Plan, puis accord

Découpez en 3 à 15 modules par responsabilité (pas forcément par dossier). Montrez à l'utilisateur, en 25 lignes au plus : ce qu'est le projet, l'arborescence prévue, les contrats et schémas prévus, ce qui est écarté, les doutes. Attendez son accord (session non interactive, ou accord déjà donné dans la demande : continuez).

Arborescence par défaut, branches vides omises :

- **Nom du projet** (`concept`) : Architecture · Modules · Données et contrats · Configuration · Dépendances et services externes · Procédures · Décisions · Règles · Risques et dettes · Couverture : nom de la ressource (`task`)

## 3. Socle

En un `nodal_apply` (deux si besoin) :

- Racine : résumé, document « Vue d'ensemble » (but, utilisateurs, pile, lancement, carte des dossiers).
- Branches, et un nœud par module : résumé tiré d'une lecture du point d'entrée, ancrages.
- Architecture : document `mermaid` « Vue des modules » (`flowchart`).
- Relations entre modules, prouvées par un import ou un appel.
- « Couverture : nom de la ressource » : document `csv` « Couverture », une ligne par module et par production transverse, colonnes `sujet,chemins,fichiers,fiche,json,exemples,csv,schémas,code,raison`, états `fait`, `à faire`, `sans objet` (`raison` dit pourquoi).

Dès cette étape la base est utilisable ; la suite peut être interrompue et reprise.

## 4. Modules, un par un

Dans l'ordre de dépendance (les plus utilisés d'abord), suivez `../nodal-module/SKILL.md`, avec les contrats (`../nodal-contrats/SKILL.md`) et les schémas (`../nodal-schemas/SKILL.md`) du module ; lisez ces fichiers une fois. Un `nodal_apply` par module (petits modules : deux ou trois ensemble), qui met aussi à jour « Couverture » (`updateDocument`, `mode: "replace"`). Ne lisez pas tout avant d'écrire.

Continuez jusqu'au dernier module sans vous arrêter pour demander. Si vous devez vous interrompre, « Couverture » doit être à jour : `/nodal-scan` reprendra là. Sous-agents de lecture seulement si l'utilisateur en veut ; vous seul écrivez.

## 5. Transverse

- Procédures : installer, lancer, tester, construire, livrer, migrer ; commandes prises dans les manifestes et la CI. Vous ne les avez pas lancées : ne dites pas qu'elles marchent.
- Décisions : ADR, commentaires qui expliquent un choix, messages de commit. Raison introuvable : `## À confirmer`, jamais une raison plausible inventée.
- Règles (validation, droits, invariants : `rule`), risques et dettes (`risk`, `issue`, `task` ; `TODO`, `FIXME` significatifs, pas tous), rôles (`actor`), services externes (`resource`).
- Inventaires CSV du projet entier, sur la branche qui les porte.
- Un `sequenceDiagram` pour chacun des 1 à 3 parcours principaux, sous Architecture.
- Vues du graphe (`view`, voir « Vues du graphe » dans les conventions) : 3 à 6, nommées par ce qu'elles montrent, sans doubler une vue existante (`nodal_overview`). Par exemple « Architecture » (`types` component, data), « Décisions et règles » (`types` decision, rule, requirement), « Risques et dettes » (`types` risk, issue, task), une vue `solo` par module central. Ne les ouvrez pas : citez-les dans le bilan, l'utilisateur les choisit dans « Vues ▾ ».

## 6. Contrôle

1. Reprenez le tableau « Ce que le scan doit produire » et « Couverture » : plus aucun `à faire` (sauf `rapide` ou arrêt demandé), chaque `sans objet` a sa raison. Comptez les documents par type ; un type absent (`json`, `csv`, `mermaid`, `code`) doit s'expliquer.
2. `nodal_health` : corrigez ce qui vient de vous (sans résumé, documents vides, isolés, liens cassés, doublons).
3. Posez à `nodal_search` cinq questions d'un nouvel arrivant (où commence l'exécution, comment ajouter X, où sont validées les entrées, comment lancer les tests, que casse un changement de Y). Réponse absente : complétez.
4. `nodal_for_files` sur cinq fichiers importants : chacun doit avoir sa fiche, sans `stale`.
5. `nodal_health` avec `graph: true`, puis `nodal_impact` sur un module central : un module sans relation ou un impact vide révèle des liens oubliés.
6. Reprenez au hasard cinq affirmations écrites et vérifiez-les dans le code.

Terminez en 15 lignes au plus : nœuds, documents par type et relations écrits, vues créées, productions `sans objet` et pourquoi, fichiers couverts et non couverts, doutes à confirmer, suite conseillée. Rappelez que les ajouts se relisent et s'annulent dans Nodal, et que `/nodal-maj` tient la base à jour.
