# Nodal

Application desktop Windows de base de connaissances techniques sous forme de
graphe : nœuds hiérarchiques contenant des documents typés (Markdown, texte,
JSON, code, Mermaid), reliés par des relations nommées. Locale, sans backend,
le code stocké n'est jamais exécuté.

Spécifications : [`docs/cahier_des_charges_techniques_knowledge_graph_v1_2.docx`](docs/).

Un espace de connaissances = **un fichier `.nodal`** (base SQLite unique,
pièces jointes en BLOB).

## État

- **Lot 1 — Fondation** : application Electron sécurisée, persistance SQLite,
  migrations, création / ouverture / fermeture d'un espace.
- **Lot 2 — Modèle documentaire** :
  - espaces récents, renommage, description, suppression (vers la corbeille),
    taille maximale des pièces jointes ;
  - nœuds : arborescence navigable au clavier, création, renommage, type,
    résumé, couleur, déplacement (cycles refusés), réordonnancement,
    duplication, suppression avec stratégie explicite pour les enfants ;
  - documents typés (Markdown, texte, JSON, code, Mermaid) ordonnés, édités
    en texte brut avec enregistrement automatique ;
  - tags réutilisables, pièces jointes en BLOB (jamais ouvertes ni exécutées) ;
  - état d'enregistrement dans la barre d'état, enregistrement forcé à la
    fermeture de la fenêtre.

- **Lot 3 — Graphe** :
  - vue Graphe **en 3D** (three.js + d3-force-3d), vue par défaut à
    l'ouverture d'un espace ; la vue Documents reste accessible ;
  - une forme et une couleur par type de nœud (sphère, cube, cylindre,
    octaèdre, cône, dodécaèdre), étiquettes lisibles quel que soit le zoom,
    relations fléchées et libellées, hiérarchie en pointillés, brouillard
    de profondeur ;
  - souris : glisser le fond pour pivoter, clic droit pour déplacer la vue,
    molette pour zoomer, **glisser d'un nœud vers un autre pour les
    relier**, Maj + glisser pour déplacer un nœud, double-clic pour ouvrir ;
  - positions 3D enregistrées (migration 002 : `position_z`), disposition
    automatique par simulation de forces ;
  - portée « tout l'espace » ou « voisinage » sur 1 à 5 niveaux, filtres par
    type de nœud, tag et type de relation ;
  - relations modifiables et supprimables depuis le panneau de droite ;
    types de relations par espace (ajout, renommage, couleur, suppression
    refusée tant qu'ils sont utilisés).

Éditeurs riches et rendu Markdown / Mermaid (lot 4), recherche et export
(lot 5) restent à faire.

Raccourcis : `Ctrl+N` sous-nœud du nœud sélectionné, `Ctrl+Maj+N` nœud racine,
`Ctrl+S` enregistrer immédiatement, `F2` renommer, `Suppr` supprimer, flèches
pour parcourir l'arborescence.

## Stack

- Electron 45 + Electron Forge 8 (Vite 8), makers Squirrel (installateur) et ZIP
- React 19 + TypeScript 6 (strict)
- three.js + d3-force-3d pour le graphe 3D (choix utilisateur, à la place
  de Cytoscape.js recommandé au §4 du cahier des charges, limité à la 2D)
- SQLite via le module intégré **`node:sqlite`** (`DatabaseSync`)
- zod pour la validation des messages IPC
- Vitest + Testing Library, oxlint + oxfmt

### Pourquoi `node:sqlite` plutôt que better-sqlite3

- Fourni par le Node embarqué d'Electron : aucun module natif à recompiler
  pour Electron, packaging simplifié.
- Même API sous Node 22 (tests Vitest) et dans Electron (SQLite 3.53, FTS5 et
  BLOB disponibles).
- `node:sqlite` n'est pas listé dans `builtinModules` sous Node 22 : il est
  déclaré explicitement en `external` dans `vite.main.config.mts`.

## Structure

```
src/
  main/        processus principal : fenêtre, sécurité, IPC, base, espaces
    database/  connexion, migrations versionnées (PRAGMA user_version)
    ipc/       handlers validés (émetteur + zod), enveloppe { ok, data | error }
    knowledge/ services métier : nœuds, documents, tags, pièces jointes, réglages
    workspace/ espace ouvert et espaces récents
  preload/     window.nodal : invoke() limité à la liste blanche des canaux
  shared/      contrat IPC typé, schémas zod, modèle et constantes du domaine
  renderer/
    app/       racine, contexte (client, suivi d'enregistrement), barre d'état
    features/  workspace, nodes, documents, tags, attachments, graph, relations
    components/ modale, confirmation
tests/         tests Vitest (base, services, IPC, renderer)
```

## Scripts

| Commande            | Rôle                                           |
| ------------------- | ---------------------------------------------- |
| `npm start`         | lance l'application en développement           |
| `npm test`          | tests unitaires (Vitest)                       |
| `npm run typecheck` | vérification TypeScript                        |
| `npm run lint`      | oxlint + vérification du format (oxfmt)        |
| `npm run lint:fix`  | corrige le lint et formate                     |
| `npm run package`   | application packagée dans `out/`               |
| `npm run make`      | installateur Windows (Squirrel) et archive ZIP |

Prérequis : Node ≥ 22.13 (pour `node:sqlite` dans les tests).
