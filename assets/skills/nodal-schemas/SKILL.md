---
name: nodal-schemas
description: Dessiner dans Nodal les schémas Mermaid d'un projet ou d'un module à partir du code - architecture, séquence, modèle de données, états, flux, classes. À utiliser quand l'utilisateur demande un diagramme ou un schéma du code dans Nodal.
argument-hint: '[sujet ou type de schéma]'
---

<!-- Installé par Nodal : remplacé à chaque installation. -->

# Schémas Mermaid

Sujet : $ARGUMENTS (vide : les schémas qui manquent le plus)

Lisez d'abord `../nodal/conventions.md` (chemin relatif au dossier de ce skill), sauf si c'est déjà fait dans cette session.

| Question                               | Schéma                      | À lire                      |
| -------------------------------------- | --------------------------- | --------------------------- |
| De quoi est fait le système ?          | `flowchart` avec `subgraph` | points d'entrée, imports    |
| Que se passe-t-il quand… ?             | `sequenceDiagram`           | les appels, de bout en bout |
| Comment les données sont-elles liées ? | `erDiagram`                 | migrations, modèles ORM     |
| Par quels états passe-t-il ?           | `stateDiagram-v2`           | énumération, transitions    |
| Quelles règles décident ?              | `flowchart` avec losanges   | la fonction de décision     |
| Quels types, quelles interfaces ?      | `classDiagram`              | définitions de types        |

1. `nodal_search` : un schéma du sujet existe, mettez-le à jour (`updateDocument`, `mode: "replace"`). Ne touchez pas au schéma de branche que l'application produit (commentaire `%%` en première ligne).
2. Lisez le code de **chaque** flèche. Pas lu : pas de flèche.
3. 15 éléments et 25 flèches au plus ; au-delà, une vue d'ensemble et un schéma par partie. Noms du code, verbe sur chaque flèche.
4. Syntaxe sûre : identifiants courts en ASCII (`svc1`), texte entre guillemets (`svc1["Service d'envoi (SMTP)"]`, `a -->|"écrit"| b`) ; pas de `end` ni de mot réservé comme identifiant ; dans `sequenceDiagram`, ni `;` ni `#` dans les messages ; dans `erDiagram`, types en un seul mot et cardinalités explicites (`USER ||--o{ ORDER : "passe"`) ; ni `click`, ni HTML, ni directive `init`, ni couleurs.
5. `nodal_apply` : `addDocument` `mermaid` sur le nœud décrit, titre qui dit la question (« Séquence : envoi d'une commande ») ; une phrase dans un document `markdown` du nœud sur ce que le schéma omet ; `anchor` des fichiers suivis, `review` de ceux lus.
6. Relations vues en dessinant et absentes du graphe : `link` avec preuve.
7. Relisez le source ligne par ligne (parenthèses, guillemets, blocs fermés) : Nodal ne valide pas Mermaid à l'écriture. Invitez l'utilisateur à ouvrir l'aperçu.
