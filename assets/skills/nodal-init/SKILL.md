---
name: nodal-init
description: Créer (ou reprendre) la base de connaissances Nodal d'un projet à partir de son code - inventaire, architecture, modules, contrats JSON, schémas Mermaid, CSV, procédures, décisions. Long et coûteux, lancé par l'utilisateur.
argument-hint: '[rapide | complet] [dossier]'
disable-model-invocation: true
---

<!-- Installé par Nodal : remplacé à chaque installation. -->

# Initialiser la base d'un projet

Demande : $ARGUMENTS

Lisez d'abord `../nodal/conventions.md` (chemin relatif au dossier de ce skill). `rapide` : étapes 1, 2, 3 et 6. Sinon : tout. Un dossier : limitez-vous à lui.

## 1. État des lieux

En parallèle : `nodal_overview`, `nodal_tree` (depth 3), et dans le dépôt : fichiers suivis par git (comptes par dossier et extension si la liste est longue), README, manifestes (package.json, pyproject, Cargo.toml, go.mod, pom, csproj…), points d'entrée, CI, documentation et ADR existants, 30 derniers commits. Pas de dépôt git : listez les fichiers.

Écartez : dépendances, fichiers générés, binaires, sorties de construction, fichiers de verrouillage, secrets.

Un nœud « Documentation du code » existe déjà : c'est une reprise. Lisez son document « Couverture » et continuez aux lignes `à faire`.

## 2. Plan, puis accord

Découpez en 3 à 15 modules par responsabilité (pas forcément par dossier). Montrez à l'utilisateur, en 25 lignes au plus : ce qu'est le projet, l'arborescence prévue, les contrats et schémas prévus, ce qui est écarté, les doutes. Attendez son accord (session non interactive, ou accord déjà donné dans la demande : continuez).

Arborescence par défaut, branches vides omises :

- **Nom du projet** (`concept`) : Architecture · Modules · Données et contrats · Procédures · Décisions · Documentation du code (`task`)

## 3. Socle

En un `nodal_apply` (deux si besoin) :

- Racine : résumé, document « Vue d'ensemble » (but, utilisateurs, pile, lancement, carte des dossiers).
- Branches, et un nœud par module : résumé tiré d'une lecture du point d'entrée, ancrages.
- Architecture : document `mermaid` « Vue des modules » (`flowchart`).
- Relations entre modules, prouvées par un import ou un appel.
- « Documentation du code » : document `csv` « Couverture », colonnes `module,chemins,fichiers,fiche,contrats,schémas`, états `fait`, `à faire`, `sans objet`.

Dès cette étape la base est utilisable ; la suite peut être interrompue et reprise.

## 4. Modules, un par un

Dans l'ordre de dépendance (les plus utilisés d'abord), suivez `../nodal-module/SKILL.md`, avec les contrats (`../nodal-contrats/SKILL.md`) et les schémas (`../nodal-schemas/SKILL.md`) du module ; lisez ces fichiers une fois. Un `nodal_apply` par module (petits modules : deux ou trois ensemble), qui met aussi à jour « Couverture » (`updateDocument`, `mode: "replace"`). Ne lisez pas tout avant d'écrire.

Dépôt de plus de 300 fichiers utiles : après trois ou quatre modules, dites où vous en êtes et proposez de continuer ou de reprendre plus tard (`/nodal-init`). Sous-agents de lecture seulement si l'utilisateur en veut ; vous seul écrivez.

## 5. Transverse

- Procédures : installer, lancer, tester, construire, livrer, migrer ; commandes prises dans les manifestes et la CI. Vous ne les avez pas lancées : ne dites pas qu'elles marchent.
- Décisions : ADR, commentaires qui expliquent un choix, messages de commit. Raison introuvable : `## À confirmer`, jamais une raison plausible inventée.
- Règles (validation, droits, invariants), risques et dettes (`TODO`, `FIXME` significatifs, pas tous).
- Un `sequenceDiagram` pour chacun des 1 à 3 parcours principaux, sous Architecture.

## 6. Contrôle

1. `nodal_health` : corrigez ce qui vient de vous (sans résumé, documents vides, isolés, liens cassés, doublons).
2. Posez à `nodal_search` cinq questions d'un nouvel arrivant (où commence l'exécution, comment ajouter X, où sont validées les entrées, comment lancer les tests, que casse un changement de Y). Réponse absente : complétez.
3. `nodal_for_files` sur cinq fichiers importants : chacun doit avoir sa fiche, sans `stale`.
4. Reprenez au hasard cinq affirmations écrites et vérifiez-les dans le code.

Terminez en 15 lignes au plus : nœuds, documents et relations écrits, fichiers couverts et non couverts, doutes à confirmer, suite conseillée. Rappelez que les ajouts se relisent et s'annulent dans Nodal, et que `/nodal-maj` tient la base à jour.
