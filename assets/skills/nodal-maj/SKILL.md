---
name: nodal-maj
description: Remettre la base Nodal à jour après des changements du code (commits, branche, modifications en cours) - fiches dépassées, nouveaux fichiers, contrats, schémas, ancrages. À utiliser après un développement ou une fusion, ou quand plusieurs fiches sont signalées stale.
argument-hint: '[référence ou intervalle git, ou sujet]'
---

<!-- Installé par Nodal : remplacé à chaque installation. -->

# Mettre la base à jour

Portée : $ARGUMENTS (vide : modifications non committées et commits de la branche ; s'il n'y en a pas : fiches `stale` de `nodal_health`)

Lisez d'abord `../nodal/conventions.md` (chemin relatif au dossier de ce skill), sauf si c'est déjà fait dans cette session.

1. `git status --short`, `git diff --stat` et `git log --oneline` sur la portée ; `nodal_health` en parallèle.
2. `nodal_for_files` sur les fichiers changés : fiches (`stale`), fichiers sans fiche (`notAnchored`), nœuds touchés (`affected`). Changement large : `nodal_impact`.
3. Triez : **faux** (la fiche dit autre chose que le code), **manquant** (nouveau comportement, contrat, décision), **inchangé** (remise en forme, interne). Le faux d'abord ; plus de huit fiches : dites l'ordre et faites les plus utilisées.
4. Fiche fausse : lisez-la, lisez le diff, corrigez seulement ce qui a changé. `mode: "replace"` remplace le document **entier** : repartez du texte complet (`nextOffset` nul), jamais d'un extrait. Ce que l'utilisateur a écrit se garde.
5. Dans le même lot : inventaires CSV et JSON touchés (`../nodal-contrats/SKILL.md`), schémas touchés (`../nodal-schemas/SKILL.md`), ancrages (fichier renommé : `remove` et `add`), relations nouvelles. Module entier nouveau : `../nodal-module/SKILL.md`. Ligne de « Couverture » si la base en a une.
6. `nodal_apply`, avec `review` des fichiers relus, y compris pour les fiches restées justes. Jamais `review` d'un fichier non lu.
7. Rien ne se supprime : un nœud caduc reçoit un résumé qui le dit, et son remplaçant une relation `remplace` vers lui.

Terminez par : corrigé, ajouté, déclaré relu, reste à revoir.
