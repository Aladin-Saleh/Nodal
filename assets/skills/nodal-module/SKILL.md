---
name: nodal-module
description: Documenter en profondeur dans Nodal un module, un dossier ou une fonctionnalité du code (fiche, fonctions clés, règles, pièges, contrats, schémas, relations, ancrages). À utiliser quand l'utilisateur demande de documenter une partie du code dans Nodal.
argument-hint: '<dossier, fichier ou nom du module>'
---

<!-- Installé par Nodal : remplacé à chaque installation. -->

# Documenter un module

Module : $ARGUMENTS

Lisez d'abord `../nodal/conventions.md` (chemin relatif au dossier de ce skill), sauf si c'est déjà fait dans cette session.

1. **Ce qui existe** : `nodal_search` (nom du module) et `nodal_for_files` (fichiers principaux), en parallèle. Nœud trouvé : complétez-le, lisez ses documents en entier avant de les remplacer.
2. **Lire** : interface publique, types, points d'entrée, puis le cœur ; imports entrants et sortants par une recherche. Les tests disent les cas limites ; les commentaires et l'historique git du chemin, les raisons. Plus de 25 fichiers : découpez en sous-modules.
3. **Écrire**, en un `nodal_apply` :
   - nœud `component` et `anchor` ;
   - document `markdown` « Fonctionnement » : rôle et limites (ce qu'il ne fait pas) ; entrées et sorties ; déroulé des cas importants ; fichiers clés (tableau fichier, rôle) ; erreurs et cas limites ; pièges ; comment l'étendre. Rubrique sans contenu : omise ;
   - sous-nœuds seulement si on les cherchera seuls : algorithme (`function`), invariant (`rule`), entité (`data`), choix (`decision`) ;
   - contrats d'entrée/sortie, s'il en expose ou en consomme : `../nodal-contrats/SKILL.md` ;
   - schéma, seulement s'il montre ce que le texte dit mal : `../nodal-schemas/SKILL.md` ;
   - `link` vers les modules utilisés, avec preuve (ligne d'import ou d'appel) ;
   - `review` des fichiers réellement lus.
4. **Contrôler** : `nodal_get_node` sur le nœud ; vérifiez deux affirmations dans le code.

Terminez par ce qui a été écrit, les fichiers non lus et les points à confirmer.
