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

- **Graphe — compléments** :
  - clic sur un nœud : zoom animé et documents affichés en pages 3D à côté
    de lui (clic sur une page : édition par-dessus le graphe) ; documents
    aussi listés dans le panneau latéral ;
  - double-clic dans le vide : nouveau nœud à cet endroit (parent au choix) ;
  - sélection multiple (Ctrl+clic, Ctrl+A) et actions groupées : déplacer
    sous un parent ou à la racine, changer le type, supprimer ;
  - champ « Parent » pour passer un nœud en racine ou le rattacher à un autre ;
  - clic sur une relation (à quelques pixels près du trait, ou sur son
    libellé) : fiche avec extrémités, type, libellé et description,
    modification et suppression ; description saisissable à la création et
    à la modification d'une relation ;
  - lisibilité des grands graphes : étiquettes placées sans chevauchement,
    ni sur un nœud plus important (sélection et survol d'abord, puis voisins
    et résultats de recherche, puis nœuds les plus reliés et les plus
    proches), les autres au survol ou en zoomant ; disposition qui regroupe
    chaque branche et écarte les branches entre elles ; repliage d'une
    branche (« Replier », « Tout replier », « Tout déplier »), le nœud
    replié indiquant le nombre de descendants masqués ;
  - l’œil (arborescence) : masquer un nœud et ses descendants dans le
    graphe, ou n’afficher qu’une branche (Alt+clic), touche H ; affichage
    seulement (recherche, export et MCP inchangés) ;
  - réglages du graphe conservés par espace (portée, filtres, replis,
    masquages), clé `view.graph` de `workspace_settings`, hors export ;
  - arborescence : glisser-déposer (avant, après ou dans un nœud, cycles
    refusés) et menu contextuel (clic droit, touche Menu, Maj+F10) ;
  - relecture des ajouts de l’IA : filtre « Ajouté par l’IA, non validé »,
    marque « IA » dans l’arbre, action « Valider » (migration 005,
    `assistant_change.validated_at`) ;
  - préférence « Lier le repli de l’arbre et du graphe ».
- **Lot 4 — Contenus riches** :
  - éditeur CodeMirror 6 pour tous les documents : coloration (Markdown,
    JSON, Java, JS/TS, Python, SQL, Go, YAML, Bash, C/C++), numéros de
    ligne, repliage, bouton Copier ;
  - aperçu Markdown sécurisé (HTML brut échappé, seuls les liens web, mail
    et internes sont conservés) ; `[[Titre du nœud]]` ouvre le nœud ;
  - rendu Mermaid local (`securityLevel: strict`), affiché comme image
    isolée ; erreurs de syntaxe affichées sans interrompre l'édition ;
  - JSON : validation non bloquante, mise en forme sur action explicite.
- **Lot 5 — Recherche et portabilité** :
  - recherche plein texte SQLite FTS5 (migration 003, tenue à jour par
    triggers) sur titres, résumés et documents, code compris, sans accents ;
  - export portable : dossier avec `manifest.json` versionné, documents au
    format source, pièces jointes, `LISEZMOI.txt` ;
  - import d'un export : validation préalable (schéma, références, cycles,
    chemins confinés au dossier, empreintes SHA-256) avec rapport
    d'erreurs, puis création d'un nouvel espace (identifiants conservés) ;
  - sauvegarde de secours (`VACUUM INTO`) et vérification d'intégrité
    (structure, clés étrangères, index de recherche reconstruit si besoin) ;
  - export pour LLM : `graph.toon` (TOON) + `graph.json` équivalent,
    documents sources, `chunks.jsonl` (fragments découpés selon la
    structure, identifiants reproductibles, tokens comptés avec
    js-tiktoken / o200k_base), portée espace, sous-arbre ou voisinage.

- **Lot 6 — Stabilisation** :
  - performances mesurées sur 3 000 nœuds, 6 000 documents et 4 000
    relations (`npm run test:perf`) : recherche ≈ 20-30 ms, graphe ≈ 13 ms,
    enregistrement automatique ≈ 2 ms ; exports asynchrones (l'application
    reste réactive) ; étiquettes 3D créées à la demande au-delà de 250 nœuds ;
  - robustesse : erreurs de rendu isolées par zone, messages dédiés pour un
    fichier verrouillé ou un disque plein, test statique garantissant
    qu'aucun chemin du code ne peut exécuter de contenu ;
  - tests de bout en bout dans Electron (`npm run test:e2e`, Playwright) :
    création d'un espace et d'une hiérarchie, relation, documents Markdown /
    code / Mermaid, recherche dans le code, fermeture et réouverture,
    export puis réimport ;
  - installateur Windows (`npm run make`) avec icône de l'application ;
  - [guide d'utilisation](docs/guide-utilisateur.md) et aide intégrée (F1).

- **Serveur MCP — base partagée avec un assistant IA** :
  `resources/nodal-mcp.cjs`, exécuté par Node.js ≥ 22.13
  (`node nodal-mcp.cjs <fichier.nodal> [--read-only]`, stdio). Pas lancé par
  l'exécutable Electron, qui écrit une ligne vide sur stdout au démarrage
  sous Windows.
  - lecture : `nodal_overview`, `nodal_search`, `nodal_get_node`,
    `nodal_read_document` (par tranches), `nodal_tree`,
    `nodal_neighborhood` ; réponses structurées en TOON (listes
    tabulaires), contenu des documents brut, identifiants abrégés (plus
    court préfixe unique d'UUID, 8 caractères au moins ; voir le
    [benchmark](docs/benchmark-tokens-mcp.md)) ;
  - `nodal_search`, premier appel conseillé, renvoie le résumé des nœuds
    trouvés et le contenu des documents trouvés (12 000 caractères par
    défaut, `maxChars`), et se rabat sur « au moins un mot » si aucun nœud
    ne les contient tous ; il est marqué `anthropic/alwaysLoad` pour que
    Claude Code le charge sans passer par sa recherche d'outils ; d’un long
    document, seules les sections qui contiennent le plus de mots cherchés
    sont renvoyées, avec leur `offset` ; `nodal_get_node` inclut le contenu
    des documents courts ;
  - `nodal_apply` : plusieurs écritures (nœud, documents, relations, tags)
    en un appel et une transaction (tout ou rien), références `$1`, `$2`…
    aux éléments créés plus tôt dans le même appel ;
  - orientation : `nodal_overview` donne les racines (avec leur nombre de
    descendants), les nœuds les plus reliés, l'activité récente et la part
    créée par l'assistant ;
  - provenance : `createdBy` (nœud) et `by` (relation) valent `user` ou
    `assistant`, d'après le journal ; pastille « IA » dans l'application ;
    un nœud validé par l'utilisateur redevient `user` ;
  - écriture (sauf `--read-only`) : `nodal_create_node` (doublon refusé au
    même endroit), `nodal_update_node`, `nodal_add_document`,
    `nodal_update_document` (ajout en fin par défaut), `nodal_link` (type de
    relation par son nom), `nodal_tag` ; aucune suppression. Via les
    services métier, une transaction par appel ;
  - journal `assistant_change` (migration 004) écrit dans la même
    transaction, avec états avant / après ; fenêtre « Activité IA » pour
    relire et annuler (refusé si l'élément a été retouché depuis) ;
  - une connexion par appel (`query_only` en lecture) : aucune transaction
    ne reste ouverte, aucun fichier annexe ne reste ;
  - Nodal détecte les écritures d'un autre processus (`PRAGMA data_version`,
    chaque seconde) et recharge l'affichage, après la fin d'une saisie en
    cours le cas échéant ;
  - configuration prête à copier : menu Export → « Connecter un assistant IA
    (MCP)… », avec un bloc de consignes CLAUDE.md / AGENTS.md pour que
    l'assistant consulte Nodal avant de parcourir les fichiers.

Raccourcis : `Ctrl+N` sous-nœud du nœud sélectionné, `Ctrl+Maj+N` nœud racine,
`Ctrl+S` enregistrer immédiatement, `Ctrl+F` rechercher, `Ctrl+A` tout
sélectionner dans le graphe, `Échap` vider la sélection ou la recherche,
`F2` renommer, `Suppr` supprimer, `F1` aide, `Ctrl+,` préférences,
`Ctrl+=` / `Ctrl+-` / `Ctrl+0` taille du texte, flèches pour parcourir
l'arborescence, `H` masquer le nœud dans le graphe, touche Menu ou
`Maj+F10` menu contextuel du nœud.

Préférences de l'application (profil utilisateur, `preferences.json`) :
thème (système, clair, sombre, appliqué par `nativeTheme`), couleur
d'accent, densité, taille du texte (zoom de la fenêtre), vue à l'ouverture
d'un espace, réouverture du dernier espace, aide des gestes du graphe. La
taille et la position de la fenêtre sont mémorisées (`window-state.json`). Le détail est dans le [guide d'utilisation](docs/guide-utilisateur.md).

## Stack

- Electron 45 + Electron Forge 8 (Vite 8), makers Squirrel (installateur) et ZIP
- React 19 + TypeScript 6 (strict)
- three.js + d3-force-3d pour le graphe 3D (choix utilisateur, à la place
  de Cytoscape.js recommandé au §4 du cahier des charges, limité à la 2D)
- CodeMirror 6 (édition), markdown-it (aperçu), Mermaid (diagrammes)
- SQLite via le module intégré **`node:sqlite`** (`DatabaseSync`), FTS5
- @toon-format/toon et js-tiktoken pour l'export LLM
- @modelcontextprotocol/server pour le serveur MCP
- zod pour la validation des messages IPC et des manifests d'import
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
    components/ modale, confirmation, isolation des erreurs
tests/         tests Vitest (base, services, IPC, renderer), e2e/ (Electron), perf/
docs/          cahier des charges, guide d'utilisation
scripts/       génération de l'icône
```

## Scripts

| Commande            | Rôle                                           |
| ------------------- | ---------------------------------------------- |
| `npm start`         | lance l'application en développement           |
| `npm test`          | tests unitaires (Vitest)                       |
| `npm run test:e2e`  | tests de bout en bout dans Electron            |
| `npm run test:perf` | mesures de performance (3 000 nœuds)           |
| `npm run typecheck` | vérification TypeScript                        |
| `npm run lint`      | oxlint + vérification du format (oxfmt)        |
| `npm run lint:fix`  | corrige le lint et formate                     |
| `npm run package`   | application packagée dans `out/`               |
| `npm run make`      | installateur Windows (Squirrel) et archive ZIP |

Les artefacts sont produits dans `out/make/` : `squirrel.windows/x64/NodalSetup.exe`
(installation pour l'utilisateur courant, sans droits administrateur) et
`zip/win32/x64/Nodal-win32-x64-<version>.zip` (version portable). L'icône est
générée par `node scripts/generate-icon.mjs` (`assets/`). L'exécutable n'est
pas signé : Windows SmartScreen affiche un avertissement au premier lancement.

Prérequis : Node ≥ 22.13 (pour `node:sqlite` dans les tests).
