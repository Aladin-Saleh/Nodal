# Nodal

Application desktop Windows de base de connaissances techniques sous forme de
graphe : nœuds hiérarchiques contenant des documents typés (Markdown, texte,
JSON, code, Mermaid, CSV), reliés par des relations nommées. Locale, sans backend,
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
  `resources/nodal-mcp.cjs`, exécuté par Node.js ≥ 22.13 (fourni sous Windows)
  (`node nodal-mcp.cjs <fichier.nodal> [--read-only]`, stdio). Pas lancé par
  l'exécutable Electron, qui écrit une ligne vide sur stdout au démarrage
  sous Windows.
  - lecture : `nodal_overview`, `nodal_search`, `nodal_get_node`,
    `nodal_read_document` (par tranches), `nodal_tree`,
    `nodal_neighborhood`, `nodal_path` (plus court chemin entre deux
    nœuds) ; réponses structurées en TOON (listes
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
  - configuration prête à copier : menu Assistant IA → « Connecter un assistant IA
    (MCP)… », avec un bloc de consignes CLAUDE.md / AGENTS.md pour que
    l'assistant consulte Nodal avant de parcourir les fichiers.
  - contexte automatique (Claude Code, Gemini CLI) : un hook
    (`node nodal-mcp.cjs <espace> --context`) ajoute à chaque demande les
    nœuds et documents pertinents, installé depuis la même fenêtre.

- **v1.6 — Ergonomie** :
  - menus homogènes : barre supérieure réduite à Espace ▾ / Assistant IA ▾,
    menu ⋯ du nœud identique au clic droit de l'arborescence, menu ⋯ du
    document, barre du graphe sur une ligne avec zoom flottant ;
  - terminal intégré (Ctrl + J) : node-pty + xterm.js, shell dans le dossier
    de code de l'espace, `NODAL_WORKSPACE` défini ; node-pty est embarqué hors
    de l'archive asar (`scripts/stage-node-pty.mjs`).

- **v1.4 — Navigation** :
  - palette de commandes (`Ctrl+P`, `Ctrl+Maj+P` pour les actions seules) :
    nœuds par titre et chemin (correspondance approximative, sans accents)
    et actions de l'application ; un registre d'actions unique alimente la
    palette, la barre supérieure, le menu contextuel de l'arbre, les
    raccourcis et l'aide ;
  - historique de navigation : précédent / suivant (`Alt+←` / `Alt+→`,
    boutons 4 / 5 de la souris, deux boutons dans la barre supérieure) sur
    les nœuds ouverts par n'importe quel moyen ; pile de 100, nœuds
    supprimés sautés ;
  - vues graphe enregistrées (migration 006, table `graph_view`) : portée,
    niveaux, filtres, masquages / solo, replis et caméra ; créer, mettre à
    jour, renommer, supprimer, vue ouverte avec l'espace ; les réglages
    existants deviennent la vue « Par défaut » ;
  - « Chemin vers… » (menu contextuel, palette) : plus court chemin entre
    deux nœuds par les relations (option : par la hiérarchie), mis en
    évidence dans le graphe, étapes et type de chaque relation dans le
    panneau droit ; outil MCP `nodal_path(fromId, toId, maxDepth)`.
- **v1.4 — Liens et qualité de la base** :
  - liens `[[...]]` : autocomplétion à `[[` dans l'éditeur Markdown, lien
    enregistré par identifiant (`[[node:<uuid>|texte]]`, survit aux
    renommages) et affiché par titre, `[[Titre|texte]]` accepté, liens
    cassés signalés ; chaque lien maintient une relation « est lié à »
    marquée `from_link` (migration 007), jamais une relation manuelle ;
    panneau « Mentionné dans » ; MCP : `mentionedIn` dans `nodal_get_node`,
    liens servis `[[Titre]](id)` et reconvertis à l'écriture ;
  - suggestions « Relier ? » : titre d'un autre nœud cité (mots entiers,
    sans accents, hors code et liens, titres courts ou génériques ignorés)
    sans relation existante ; relier, convertir en lien ou ignorer (refus
    mémorisés, migration 008) ; calcul par nœud, sans scan de la base ;
  - santé de la base (menu Espace, palette) : nœuds sans résumé,
    documents vides, nœuds isolés, liens cassés, doublons probables,
    ajouts de l'IA à relire, chacun avec son action ; sujets à documenter :
    recherches MCP sans résultat (requête, date, nombre ; migration 009),
    à transformer en nœud ou à ignorer ; outil MCP `nodal_health`.
- **v1.4 — Code ↔ connaissance** :
  - ancrage des nœuds aux fichiers du code : dossiers de code de l'espace
    (chemins locaux, non exportés), motifs relatifs façon pathspec git
    (`src/mcp/**`) par nœud (migration 010, table `node_anchor`), fichiers
    trouvés ou introuvables dans le panneau ;
  - documentation possiblement obsolète : dernier commit touchant les
    fichiers (lu par `execFile('git')`, sans shell, en lecture seule) comparé
    à la dernière mise à jour du nœud, repli sur les dates de modification
    hors git ; marque « MAJ » dans l'arbre, avertissement et « Marquer comme
    à jour » dans le panneau, ligne du rapport de santé ;
  - MCP : `nodal_for_files(paths)` (nœuds ancrés, au format de
    `nodal_search`), opération `anchor` de `nodal_apply`, champ compact
    `stale` dans les réponses, consignes « avant / après modification ».
- **v1.4 — Saisie** :
  - capture rapide : raccourci global configurable et désactivable
    (`Ctrl+Maj+Espace` par défaut, `globalShortcut`), petite fenêtre au
    premier plan (même renderer, mêmes réglages de sécurité, accès IPC
    limité à ses deux canaux et à la lecture des préférences) ; titre et
    note rangés dans la « Boîte de réception » de l'espace ouvert, ou du
    dernier espace récent ouvert le temps de l'écriture, sans afficher
    l'application ; rangement par glisser-déposer ou « Déplacer vers… ».
  - modèles de documents par type de nœud (Procédure, Composant, Donnée,
    Décision (ADR) pour un concept), proposés à la création d'un nœud ou
    d'un document avec le choix « Aucun » ; modifiables par espace
    (`workspace_settings`, clé `templates`, absente tant que l'espace suit
    les modèles par défaut : pas de migration), conservés par l'export
    portable ; MCP : champ `template` de `nodal_create_node` et de
    l'opération `createNode` de `nodal_apply`.
  - import d'un dossier Markdown / coffre Obsidian dans l'espace ouvert
    (menu « Espace », palette) : dossiers → hiérarchie sous une
    nouvelle racine, notes → nœuds et documents, front-matter (titre, type,
    résumé, tags, alias), liens `[[Note#Titre|texte]]` et `[texte](note.md)`
    → liens `[[node:…]]` et relations, fichiers référencés → pièces jointes ;
    aperçu avant import (liens non résolus, éléments ignorés), sauvegarde
    automatique à côté du fichier, une seule transaction ; fichiers lus comme
    données, liens symboliques et dossiers cachés ignorés.
  - « Connecter un assistant IA » : choix de l'assistant (Claude Code,
    Gemini CLI, Codex, Claude Desktop, Cursor, VS Code) et commande ou
    configuration correspondante, avec le fichier d'instructions du projet.
- **v1.5 — Types et mises à jour sans manipulation** :
  - types de nœuds pour le développement et la gestion de projet :
    fonction, règle, décision, exigence, anomalie, tâche, jalon, risque,
    acteur (forme et couleur propres, modèles de documents) ; documents
    CSV (aperçu en tableau, séparateur détecté, découpage pour LLM avec
    en-tête répété) ; migration 011 (reconstruction de `node` et
    `document`, clés étrangères vérifiées avant validation) ;
  - serveur MCP recopié au démarrage dans `%APPDATA%\Nodal\mcp` (chemin
    stable entre les versions), configurations d'assistants qui citent
    l'ancien chemin versionné corrigées automatiquement, espaces d'une
    version précédente mis à jour par le serveur lui-même.
- **v1.6 — Menus, contexte automatique et terminal** :
  - menus homogènes (« Espace ▾ », « Assistant IA ▾ », « ⋯ » du nœud et
    des documents) tirés du registre d'actions ; barre du graphe sur une
    ligne, zoom flottant ;
  - contexte automatique pour Claude Code et Gemini CLI : un hook
    (mode `--context` du serveur MCP) ajoute à chaque demande les nœuds et
    documents pertinents ; installation depuis « Connecter un assistant » ;
  - terminal intégré (`Ctrl+J`) : xterm.js et node-pty, shell ouvert dans
    le dossier de code de l'espace, variable `NODAL_WORKSPACE` définie.
- **v1.6.1 — À propos et installateur** :
  - menu « Help → À propos de Nodal » (rôle, version, auteur, contact) ;
  - animation de l'installateur (« Aladinvention's Software » en art
    ASCII et golem), générée par `npx electron scripts/generate-installer-gif.mjs`.
- **v1.7 — Connaissance sûre** (fichiers au schéma 14, illisibles par les
  versions précédentes) :
  - terminal : plusieurs onglets, type au choix (PowerShell, invite de
    commandes, Git Bash, distributions WSL), shell par défaut mémorisé ;
  - arborescence, panneau du nœud, éditeur / aperçu et terminal
    redimensionnables (souris ou flèches, double-clic : taille par défaut) ;
  - contexte automatique plus sobre : contenu des seuls nœuds sûrs, résumé
    des autres, rien de répété dans une session, secrets masqués ; rappel des
    nœuds d'un fichier avant de le lire ou de le modifier (Claude Code) ;
  - documentation possiblement obsolète : comparaison du contenu des fichiers
    (empreintes insensibles à la mise en forme, migration 012, table
    `node_code_state`) au lieu des dates ; une mise à jour par l'IA ne vaut
    que pour les fichiers qu'elle a lus (hook, ou opération `review`) ;
  - impact d’un changement (menu du nœud, `nodal_impact` pour un nœud ou des
    fichiers), chemin le plus parlant à longueur égale, relations
    superflues, cycles et questions (santé de la base, `nodal_health`) ;
  - mémoire de travail de l’assistant : impasses, corrections et nœuds utiles
    (migration 013, opération `lesson`, `nodal_lessons`, menu Assistant IA) ;
  - qualité (migration 014) : faux doublons écartés, fusion de nœuds avec
    sauvegarde, confiance et preuves vérifiées des relations ;
  - vues : schéma Mermaid d’une branche, export vers Obsidian, comparaison
    avec une sauvegarde, relations incertaines en tirets ;
  - MCP : écriture par `nodal_apply` seul (`--all-tools` pour les outils
    unitaires), mode commande, analyse dans `nodal_health`, nœuds touchés dans
    `nodal_for_files`, commandes (prompts) et skill Claude Code ;
  - réponses MCP coupées : budget nécessaire annoncé (`maxCharsNeeded`,
    `maxRowsNeeded`, `maxNodesNeeded`).
- **v1.7.1 — Documenter ses repos** :
  - « Ajouter un repo… » : connexion de l’assistant, skills, contexte
    automatique et consignes (`CLAUDE.md`…) en un clic, Node.js fourni ;
  - `/nodal-scan` documente un repo entier (JSON, Mermaid, CSV, code…), et
    cinq autres skills ;
  - plusieurs repos par espace, ancrages propres à chacun (`api:src/**`).
- **v1.7.2 — Naviguer entre code, repos et nœuds** :
  - fichiers ancrés consultables en lecture seule depuis le panneau du nœud ;
  - menu « Repos » et liste des dossiers de code dans le terminal ;
  - liens `nodal://` vers un nœud (« Copier le lien », terminal, Markdown,
    réponses des assistants).
- **v1.7.3 — Vues du graphe créées par les assistants** :
  - un assistant (Claude, Gemini…) crée ou complète des vues du graphe par
    nodal_apply, avec les réglages d'un utilisateur : types, tags, nœuds
    masqués, branche seule, replis, relations, hiérarchie ;
  - les vues ne s'ouvrent jamais seules : elles apparaissent dans « Vues ▾ »,
    se relisent et s'annulent dans l'activité IA ;
  - `/nodal-scan` crée 3 à 6 vues utiles en fin de scan.

Raccourcis : `Ctrl+P` palette de commandes, `Alt+←` / `Alt+→` nœud
précédent / suivant, `Ctrl+N` sous-nœud du nœud sélectionné, `Ctrl+Maj+N` nœud racine,
`Ctrl+S` enregistrer immédiatement, `Ctrl+F` rechercher, `Ctrl+A` tout
sélectionner dans le graphe, `Échap` vider la sélection ou la recherche,
`F2` renommer, `Suppr` supprimer, `F1` aide, `Ctrl+,` préférences,
`Ctrl+=` / `Ctrl+-` / `Ctrl+0` taille du texte, flèches pour parcourir
l'arborescence, `H` masquer le nœud dans le graphe, touche Menu ou
`Maj+F10` menu contextuel du nœud, `Ctrl+Maj+Espace` capture rapide
(global, tant que Nodal est lancé).

Préférences de l'application (profil utilisateur, `preferences.json`) :
thème (système, clair, sombre, appliqué par `nativeTheme`), couleur
d'accent, densité, taille du texte (zoom de la fenêtre), vue à l'ouverture
d'un espace, réouverture du dernier espace, aide des gestes du graphe,
raccourci de capture rapide. La
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
générée par `node scripts/generate-icon.mjs` (`assets/`), l'animation de
l'installateur par `npx electron scripts/generate-installer-gif.mjs`. L'exécutable n'est
pas signé : Windows SmartScreen affiche un avertissement au premier lancement.

Prérequis : Node ≥ 22.13 (pour `node:sqlite` dans les tests).
