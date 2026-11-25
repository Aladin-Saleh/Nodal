---
name: nodal-contrats
description: Documenter dans Nodal les entrées et sorties d'un projet ou d'un module - routes d'API, IPC, commandes, événements, configuration, tables - avec schémas et exemples JSON et inventaires CSV. À utiliser pour générer des JSON d'entrée/sortie ou un inventaire d'API dans Nodal.
argument-hint: '[module, dossier ou type de contrat]'
---

<!-- Installé par Nodal : remplacé à chaque installation. -->

# Contrats d'entrée/sortie

Portée : $ARGUMENTS (vide : tout le projet)

Lisez d'abord `../nodal/conventions.md` (chemin relatif au dossier de ce skill), sauf si c'est déjà fait dans cette session.

1. **Recenser**, selon le projet : routes HTTP, GraphQL, gRPC, IPC, outils MCP, arguments de commande, files et événements, webhooks, variables d'environnement, fichiers lus ou écrits, tables et migrations, API externes appelées. Une spécification existe (OpenAPI, JSON Schema, `.proto`, zod, Pydantic, migrations) : elle fait foi, citez-la sans tout recopier.
2. **Ce qui existe** : `nodal_search` et `nodal_for_files` sur les fichiers de définition.
3. **Inventaire** `csv` par famille, sur le nœud qui la porte (« API HTTP », « Canaux IPC »…) :
   - API : `méthode,chemin,entrée,sortie,authentification,erreurs,fichier`
   - IPC, événements, commandes : `nom,sens,charge,réponse,fichier`
   - Configuration : `nom,type,obligatoire,défaut,effet,fichier` (jamais de valeur réelle)
   - Base : `table,colonne,type,contrainte,rôle`

   Tri stable par nom : les mises à jour se comparent. Rapprochez le nombre de lignes du nombre trouvé dans le code.

4. **JSON** pour les contrats importants (frontière publique, structure non triviale), sur un nœud `data` par contrat ou groupe cohérent :
   - « Entrée (schéma) » et « Sortie (schéma) » : JSON Schema avec `$schema`, `title`, types, `required`, `enum`, `description` ; traduisez les contraintes du validateur (bornes, formats), n'en ajoutez pas ;
   - « Exemple d'entrée », « Exemple de sortie », « Exemple d'erreur » : valides contre le schéma, valeurs manifestement fictives (`user@example.com`). Le résumé du nœud dit si l'exemple vient d'un test ou est construit ;
   - JSON strict : ni commentaire, ni virgule finale, ni points de suspension.
5. **Relier et ancrer** : le module `implémente` le contrat, le client `consomme` le contrat, avec preuve ; `anchor` sur les fichiers de définition ; `review` de ceux lus.

Terminez par les familles couvertes (documenté / trouvé) et les écarts constatés entre code, tests et spécification : signalez-les, ne tranchez pas.
