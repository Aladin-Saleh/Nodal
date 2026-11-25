---
name: nodal
description: Consulter et tenir à jour la base de connaissances Nodal du projet. À utiliser avant de modifier du code ou de répondre sur l'architecture, les décisions ou les procédures du projet, après une modification pour mettre la documentation à jour, et quand l'utilisateur corrige une réponse ou qu'une piste n'aboutit pas.
---

<!-- Installé par Nodal : remplacé à chaque installation. -->

# Nodal

Serveur MCP `nodal`. Un appel suffit le plus souvent : n'en faites pas plus que la question n'en demande.

## Répondre à une question

1. Les extraits `<nodal-context>` déjà présents couvrent toute la question ? Répondez, sans rappeler Nodal. Un volet manque (chiffre, raison, élément de liste) : lisez la suite du document cité.
2. Sinon `nodal_search` avec 2 à 4 mots précis ; question à plusieurs volets : plusieurs recherches en parallèle.
3. Détail d'implémentation dont dépend la réponse (condition, valeur, signature) : une lecture ciblée du fichier cité. Nodal décrit, le code fait foi.
4. Ce que touche un changement : `nodal_impact`.
5. Rien dans Nodal : lisez le code et dites-le. Question sur un fichier précis et sur rien d'autre : lisez directement le fichier.

`stale` ou `changed` : la fiche est peut-être dépassée, vérifiez dans le code. `lessons` : ne refaites pas une impasse, tenez compte des corrections.

## Avant de modifier du code

`nodal_for_files` avec tous les chemins, en un appel : fiches, décisions, leçons, et nœuds directement touchés (`affected`). Changement large : `nodal_impact`.

## Après

Un seul `nodal_apply` :

- `updateDocument` / `updateNode` des fiches devenues fausses (complétez un nœud existant plutôt que d'en créer un) ;
- `anchor` des nouveaux fichiers ;
- `review` des fichiers que vous avez relus et que la fiche reflète encore ;
- `link` avec `confidence` et `evidence` (`source: "fichier:ligne"`, `quote` recopiée) quand un lien se prouve ;
- `lesson` si une piste n'a mené à rien (`dead_end`), si l'utilisateur a corrigé (`corrected`, `note` = ce qui est juste), ou si des nœuds ont vraiment servi (`useful`).

Notez ce qui restera vrai et que le code ne dit pas : pourquoi, ce qui a été écarté et mesuré, pièges, procédures. Pas le récit de la séance.

## Documenter davantage

Autres skills : `nodal-module` (une partie du code), `nodal-contrats` (JSON et CSV d'entrée/sortie), `nodal-schemas` (Mermaid), `nodal-maj` (après des changements). Base vide, ou « documente mon projet » : `nodal-init`.
