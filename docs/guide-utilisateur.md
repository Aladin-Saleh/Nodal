# Nodal — Guide d'utilisation

Nodal est une base de connaissances techniques sous forme de graphe. Chaque
**nœud** représente un concept, un composant, une donnée, une procédure ou une
ressource ; il contient des **documents** (Markdown, texte, JSON, code,
diagrammes Mermaid), des sous-nœuds et des pièces jointes. Les nœuds sont reliés
par des **relations** nommées, indépendantes de la hiérarchie.

Tout reste sur votre poste : aucune connexion Internet n'est nécessaire et aucun
contenu n'est envoyé à l'extérieur. Le code enregistré n'est jamais exécuté.

---

## 1. Installation

1. Lancez `NodalSetup.exe`. L'application s'installe pour votre compte
   (aucun droit administrateur requis) et crée un raccourci dans le menu
   Démarrer et sur le bureau.
2. L'exécutable n'étant pas signé, Windows SmartScreen peut afficher
   « Windows a protégé votre ordinateur » : cliquez sur **Informations
   complémentaires** puis **Exécuter quand même**.
3. Version portable : décompressez `Nodal-win32-x64-<version>.zip` et lancez
   `nodal.exe`.

Désinstallation : **Paramètres Windows › Applications › Nodal ›
Désinstaller**. Vos fichiers `.nodal` ne sont pas supprimés.

## 2. Espaces de connaissances

Un espace est **un fichier `.nodal`** unique : il contient tous les nœuds,
documents, relations et pièces jointes. Vous pouvez le copier, le déplacer ou le
sauvegarder comme n'importe quel fichier (application fermée).

- **Créer** : sur l'accueil, saisissez un nom puis **Créer…** et choisissez
  l'emplacement du fichier.
- **Ouvrir** : **Ouvrir…**, ou un clic sur un espace de la liste des récents.
- **Renommer, décrire, supprimer** : bouton **Paramètres**. La suppression
  place le fichier dans la corbeille de Windows (récupérable).
- **Fermer** : bouton **Fermer l'espace**. Les modifications en cours sont
  enregistrées automatiquement.

L'état d'enregistrement s'affiche au centre de la barre d'état (en bas) :
_Enregistré_, _Modifications en attente…_, _Enregistrement…_ ou un message
d'erreur.

## 3. Le graphe (vue par défaut)

| Action                                  | Geste                                              |
| --------------------------------------- | -------------------------------------------------- |
| Faire pivoter la vue                    | glisser dans le vide                               |
| Déplacer la vue                         | glisser avec le bouton droit                       |
| Zoomer                                  | molette, ou boutons **+** / **−**                  |
| Recadrer tout le graphe                 | bouton **⤢**                                       |
| Sélectionner un nœud (zoom + documents) | clic                                               |
| Ouvrir la fiche dans la vue Documents   | double-clic sur le nœud                            |
| **Créer un nœud à cet endroit**         | double-clic dans le vide                           |
| **Relier deux nœuds**                   | glisser d'un nœud vers un autre                    |
| Déplacer un nœud                        | Maj + glisser                                      |
| Sélection multiple                      | Ctrl + clic, ou Ctrl + A (tous les nœuds affichés) |
| Vider la sélection                      | Échap                                              |

Chaque type de nœud a une forme et une couleur : Concept (sphère bleue),
Composant (cube vert), Donnée (cylindre orange), Procédure (octaèdre violet),
Ressource (cône turquoise), Générique (dodécaèdre gris). Les liens parent-enfant
apparaissent en pointillés.

- **Documents dans le graphe** : en sélectionnant un nœud, ses documents
  s'affichent en pages à côté de lui. Cliquez sur une page pour l'éditer ;
  la page « Nouveau document » en crée un.
- **Portée** : _Tout l'espace_ ou _Voisinage_ du nœud sélectionné sur 1 à 5
  niveaux (utile pour les grands espaces).
- **Filtres** : par type de nœud, tag et type de relation ; affichage ou non
  de la hiérarchie ; « Ajouté par l’IA, non validé ».
- **Réglages conservés** : la portée, les filtres, les nœuds repliés et les
  nœuds masqués sont retrouvés à la réouverture de l’espace (affichage
  seulement : rien n’est modifié dans les données ni dans les exports).
- **Vues enregistrées** : le sélecteur à gauche de la barre du graphe
  applique une vue nommée : portée, niveaux, filtres, nœuds masqués / seuls,
  nœuds repliés et position de la caméra. Le menu **Vues ▾** permet
  d’**enregistrer comme nouvelle vue**, de **mettre à jour** la vue active
  (« modifiée » s’affiche quand les réglages ont changé depuis), de la
  **renommer**, de la **supprimer** et de choisir la vue **ouverte avec
  l’espace** (★). Sans vue par défaut, l’espace rouvre sur les réglages de
  la dernière session. Les réglages d’avant la version 1.4 sont devenus la
  vue « Par défaut ». Les vues sont aussi dans la palette (Ctrl + P, « Vue :
  … »). Elles restent propres au fichier .nodal et ne sont pas incluses dans
  l’export portable.
- **L’œil** (arborescence) : au survol d’une ligne, l’œil **masque** le nœud
  dans le graphe, avec ses descendants et leurs relations (la ligne est
  grisée, l’œil reste barré). **Alt + clic** sur l’œil n’affiche que cette
  branche (ses ancêtres restent visibles) ; un nouvel Alt + clic en sort.
  Touche **H** sur le nœud sélectionné. La barre du graphe indique « N nœuds
  masqués · Tout réafficher ». Si vous sélectionnez un nœud masqué (arbre,
  recherche), le graphe le signale et propose **Le réafficher**. Masquer
  n’affecte ni la recherche, ni l’export, ni l’assistant IA.
- **Chemin vers…** (menu contextuel d’un nœud, ou palette) : choisissez un
  second nœud ; Nodal cherche le plus court chemin entre les deux par les
  relations, dans les deux sens. Le chemin ressort dans le graphe et le
  panneau de droite liste les étapes, avec le type et le sens de chaque
  relation (« → utilise », « ← dépend de ») ; un clic sur une étape
  sélectionne le nœud. Cochez **Passer aussi par la hiérarchie** pour
  emprunter les liens parent / enfant (« ↑ parent », « ↓ enfant »). S’il n’y
  a aucun chemin en 12 liens au plus, le panneau le dit. **×** ferme le
  chemin.
- **Relations** : cliquez sur un trait (ou son libellé) pour ouvrir la fiche
  de la relation : source, type, cible et description. **Modifier** permet
  de changer le type, le libellé et la description ; un clic sur une
  extrémité sélectionne ce nœud ; Échap ferme la fiche.
- **Replier** / **Déplier** : masque ou réaffiche les descendants du nœud
  sélectionné ; le nœud replié affiche leur nombre, par exemple
  « Facturation (+22) ». **Tout replier** ne garde que les racines, une par
  branche ; **Tout déplier** réaffiche tout.
- **Étiquettes** : quand le graphe est chargé, seules les étiquettes qui ont
  de la place s'affichent, les plus importantes d'abord ; survolez un nœud
  ou zoomez pour voir les autres.
- **Disposer** : relance la disposition automatique, qui regroupe chaque
  branche et écarte les branches entre elles. Les positions déjà
  enregistrées sont conservées tant que vous ne cliquez pas sur Disposer.
- **Actions groupées** (après une sélection multiple) : déplacer sous un
  parent, changer le type, valider ce qu’a ajouté l’IA, supprimer.

## 4. Nœuds et hiérarchie

- **Arborescence** (panneau gauche) : **+ Racine**, **+ Enfant**, ↑ / ↓ pour
  réordonner. Clavier : flèches pour parcourir, F2 pour renommer, Suppr pour
  supprimer, H pour masquer dans le graphe.
- **Glisser-déposer** dans l’arborescence : déposez un nœud sur le haut ou le
  bas d’une ligne pour le placer avant ou après elle, au milieu pour le ranger
  dedans. Un trait ou un cadre montre où il ira ; un nœud ne peut pas être
  déposé dans l’un de ses propres descendants.
- **Menu contextuel** (clic droit, touche Menu ou Maj + F10) : nouveau
  sous-nœud, renommer, masquer / afficher dans le graphe, centrer dans le
  graphe, ajouter un document, valider (si l’IA l’a ajouté), supprimer.
- **Panneau de propriétés** (droite) : type, **parent** (pour passer un nœud
  en racine ou le rattacher à un autre), résumé, couleur, documents,
  relations, tags, pièces jointes.
- **Supprimer un nœud** : une confirmation indique ce qui sera supprimé. Si le
  nœud a des enfants, vous choisissez de les **remonter d'un niveau** ou de
  **supprimer tout le sous-arbre**.
- **Dupliquer** : copie le nœud avec ses documents, tags et pièces jointes
  (les relations ne sont pas copiées).

### Capture rapide et boîte de réception

Pour noter une idée sans quitter ce que vous faites, appuyez sur
**Ctrl + Maj + Espace**, où que vous soyez (Nodal doit être lancé, même
réduit) : une petite fenêtre s’ouvre au premier plan.

- Saisissez un **titre** et, si besoin, une **note** (Markdown), puis
  **Entrée** (dans le titre), **Ctrl + Entrée** ou **Enregistrer**. **Échap**
  ferme sans rien enregistrer.
- La capture devient un nœud de la **Boîte de réception**, un nœud racine
  créé à la première capture ; la note devient son document « Note ».
- Elle va dans l’espace ouvert ; si aucun espace n’est ouvert, dans le
  dernier espace récent, sans l’afficher (la fenêtre l’indique : « espace
  fermé »).
- Pour **ranger** une capture : glissez-la à sa place dans l’arborescence,
  ou clic droit → **Déplacer vers…**. La palette (Ctrl + P) propose aussi
  « Boîte de réception » et « Capture rapide… ».

Le raccourci se change ou se désactive dans les préférences (section
« Capture rapide »). S’il est déjà pris par une autre application, les
préférences le signalent : choisissez-en un autre.

## 5. Documents

Un nœud contient une liste ordonnée de documents, chacun d'un seul type :
**Markdown**, **texte**, **JSON**, **code** (avec langage) ou **diagramme
Mermaid**. L'enregistrement est automatique.

- **Markdown** : modes _Édition_, _Côte à côte_, _Aperçu_. Les liens web
  s'ouvrent dans votre navigateur.

### Modèles de documents

Un modèle pré-remplit un document Markdown avec des sections à compléter.
Quatre modèles sont fournis :

| Modèle         | Proposé pour | Sections                                                              |
| -------------- | ------------ | --------------------------------------------------------------------- |
| Procédure      | Procédure    | Prérequis, Étapes, Vérification, Retour arrière                       |
| Composant      | Composant    | Rôle, Responsabilités, Dépendances, Configuration, Points d’attention |
| Donnée         | Donnée       | Schéma, Origine, Consommateurs                                        |
| Décision (ADR) | Concept      | Contexte, Décision, Conséquences, Alternatives                        |

- **À la création d’un nœud** : le champ « Modèle de document » est sur
  « Aucun » ; choisir un type propose son modèle, que vous pouvez remplacer
  par un autre ou par « Aucun ».
- **À la création d’un document** : le champ « Modèle » liste d’abord les
  modèles du type du nœud ; le titre du document reprend celui du modèle
  (modifiable) et le document est en Markdown.
- **Modifier les modèles** : palette → « Modèles de documents… », ou
  Paramètres de l’espace → « Modifier les modèles… ». Nom, type pour lequel
  le modèle est proposé, titre du document créé et contenu ; ajout et
  suppression ; « Rétablir les modèles par défaut ». Les modèles sont propres
  à l’espace et suivent l’export portable.
- **Assistant IA (MCP)** : `nodal_create_node` et `nodal_apply` acceptent
  `template` (le nom d’un modèle) pour créer un nœud avec son document.

### Liens entre nœuds `[[...]]`

- Tapez **`[[`** dans un document Markdown : Nodal propose les nœuds (titre
  ou chemin, quelques lettres suffisent). Le lien choisi est enregistré par
  l'identifiant du nœud : il **survit aux renommages** et s'affiche toujours
  avec le titre actuel, dans l'éditeur comme dans l'aperçu. Il s'efface d'un
  coup avec Retour arrière.
- `[[Titre]]` tapé à la main fonctionne aussi (lien par titre, qui se casse
  si le nœud est renommé). `[[Titre|texte]]` affiche « texte » à la place du
  titre.
- Dans l'aperçu, un clic sur le lien ouvre le nœud. Un **lien cassé** (nœud
  supprimé, titre introuvable) est barré en rouge et n'ouvre rien.
- Chaque lien crée une relation **« est lié à »** marquée « lien » dans le
  panneau de droite. Elle suit le lien : retirée quand le lien disparaît du
  document. Une relation créée à la main n'est jamais touchée ; une relation
  « lien » que vous modifiez devient une relation ordinaire.
- **Mentionné dans** (panneau de droite) : les documents qui contiennent un
  lien vers le nœud affiché, avec un extrait ; un clic ouvre le nœud ou le
  document.
- **Relier ?** (panneau de droite, seulement s'il y a quelque chose) : les
  documents Markdown ou texte du nœud citent le titre d'un autre nœud
  (titre exact, en mots entiers, sans tenir compte des accents ni des
  majuscules, hors code et hors liens) alors qu'aucune relation ne les relie.
  **Relier** crée une relation « est lié à » ; **En lien [[…]]** transforme
  la première mention en lien ; **Ignorer** ne propose plus ce nœud ici. Les
  titres de moins de 4 caractères ou trop courants (« Notes »,
  « Introduction »…), le parent et les enfants ne sont jamais proposés. Les
  suggestions sont recalculées pour le nœud affiché, à l'ouverture de son
  panneau et après chaque enregistrement de ses documents.
- **Code** : coloration selon le langage, numéros de ligne, bouton
  **Copier**. Aucune exécution n'est possible.
- **JSON** : les erreurs de syntaxe sont signalées sans bloquer la saisie ;
  **Mettre en forme** réindente le contenu sur demande uniquement.
- **Mermaid** : le diagramme est rendu localement ; en cas d'erreur de
  syntaxe, le message s'affiche et le dernier rendu valide reste visible.

### Fichiers du code

Un nœud qui documente du code peut être **ancré** aux fichiers qu'il décrit :
Nodal signale alors quand ces fichiers changent après la dernière mise à jour
du nœud.

- **Dossiers de code** : _Paramètres de l'espace_ › _Dossiers de code_ ›
  **Ajouter un dossier…** (un ou plusieurs, par exemple le dépôt du projet).
  Ce sont des chemins locaux : ils ne sont pas exportés.
- **Ancrer** (panneau de droite, rubrique _Fichiers du code_) : saisissez un
  chemin ou un motif relatif au dossier de code, puis **Ancrer** ; ou
  **Choisir des fichiers…**. Motifs : `*` (sauf `/`), `?`, `**` (tous les
  sous-dossiers) ; un chemin sans joker désigne le fichier ou tout le
  dossier (`src/mcp` = `src/mcp/**`). Chaque motif affiche le nombre de
  fichiers trouvés (**Voir les fichiers**) ou **introuvable** ; **×** le
  retire.
- **Possiblement obsolète** : un fichier ancré a changé depuis la dernière
  mise à jour du nœud (le nœud lui-même ou l'un de ses documents). Le
  panneau liste les fichiers concernés et leur date ; l'arborescence marque
  le nœud **MAJ** ; le rapport _Santé de la base_ le liste aussi. Mettez la
  documentation à jour, ou cliquez **Marquer comme à jour** si elle reste
  juste. La vérification est refaite à l'ouverture de l'espace, après chaque
  enregistrement et à chaque retour dans la fenêtre.
- **Comment Nodal date les changements** : dans un dépôt git, par le dernier
  commit qui touche le fichier, si le fichier a aussi été modifié sur le
  disque après la mise à jour du nœud (modifier le code, mettre la
  documentation à jour puis committer ne signale donc rien) ; un fichier
  supprimé compte. Hors git, ou si git n'est pas installé, par la date de
  modification du fichier. Les modifications pas encore committées ne
  comptent pas dans un dépôt git. Nodal lit l'historique sans jamais
  écrire dans le dépôt.

**Pièces jointes** : _Joindre des fichiers…_ dans le panneau de propriétés
(taille maximale réglable dans les Paramètres). Une pièce jointe n'est jamais
ouverte par Nodal : utilisez **⤓** pour en enregistrer une copie.

## 6. Recherche

### Palette de commandes

**Ctrl + P** ouvre la palette : tapez quelques lettres du titre d'un nœud, ou
de son chemin (« archi serv » trouve « Architecture › Serveur MCP »), puis
Entrée pour l'ouvrir. Les lettres n'ont pas besoin de se suivre et les accents
sont ignorés. La palette propose aussi les actions de l'application (créer un
nœud, masquer le nœud courant, basculer graphe / documents, exporter, ouvrir
les préférences…), avec leur raccourci.

**Ctrl + Maj + P** (ou « > » en début de saisie) ne propose que les actions.
Flèches haut / bas, Page préc. / suiv. pour choisir, Entrée pour valider,
Échap pour fermer. Sans rien taper, la palette propose les derniers nœuds
ouverts.

### Précédent / suivant

Nodal mémorise les nœuds ouverts, quel que soit le moyen (arbre, graphe,
recherche, palette, lien). Revenez en arrière avec **Alt + ←**, le bouton
**←** de la barre supérieure ou le bouton « précédent » de la souris, et
repartez en avant avec **Alt + →**, **→** ou le bouton « suivant ». Les nœuds
supprimés depuis sont sautés ; les 100 derniers nœuds sont gardés.

### Recherche plein texte

Barre **Rechercher** en haut (Ctrl + F). La recherche porte sur les titres,
résumés et contenus des documents, **code compris**, sans tenir compte des
accents ni des majuscules. Avec plusieurs mots, un nœud est trouvé s'il les
contient tous (dans son titre, son résumé ou ses documents).

Les nœuds trouvés ressortent dans le graphe et l'arborescence. Un clic sur un
résultat sélectionne le nœud ; un clic sur un extrait de document ouvre ce
document. Échap efface la recherche.

### Santé de la base

Bouton **Santé** (en haut de l'espace) ou palette « Santé de la base… » :
un rapport, calculé à la demande, de ce qui mérite attention, avec le nombre
de cas et, pour chacun, l'action qui permet de corriger :

- **nœuds sans résumé** et **documents vides** → Ouvrir ;
- **nœuds isolés** : ni relation ni enfant (les racines ne comptent pas) ;
- **liens `[[…]]` cassés** → Ouvrir le document ;
- **doublons probables** : titres identiques aux accents, à la casse, à la
  ponctuation ou au pluriel près, ou à une lettre près (pas à un chiffre
  près : « Étape 1 » et « Étape 2 » ne sont pas des doublons) → Ouvrir l'un
  ou l'autre ;
- **ajouts de l'IA à relire** → Valider ;
- **documentation possiblement obsolète** (nœuds ancrés à des fichiers du
  code, voir _Fichiers du code_) → Ouvrir, Marquer comme à jour ;
- **sujets à documenter** (voir ci-dessous) → Créer un nœud, Ignorer.

Les listes sont limitées à 50 lignes par vérification ; **Actualiser**
relance l'analyse.

## 7. Sauvegarde, export et import

Menu **Exporter ▾** et bouton **Paramètres** :

- **Créer une sauvegarde…** (Paramètres) : copie cohérente du fichier `.nodal`,
  même pendant l'édition. La sauvegarde s'ouvre comme n'importe quel espace.
- **Vérifier l'intégrité** (Paramètres) : contrôle la structure du fichier, les
  références et l'index de recherche (reconstruit automatiquement si besoin).
- **Export portable** : un dossier lisible sans Nodal — `manifest.json`
  (structure complète), un fichier par document dans son format d'origine,
  les pièces jointes et un `LISEZMOI.txt`.
- **Importer un export…** (accueil) : l'export est d'abord entièrement vérifié
  (structure, fichiers, empreintes). En cas de problème, un rapport liste les
  erreurs ; sinon un **nouvel espace** est créé. Aucun espace existant n'est
  modifié.
- **Export pour LLM** : un dossier destiné aux outils d'IA — le graphe au
  format **TOON** (et JSON), les documents d'origine et des fragments
  (`chunks.jsonl`) découpés selon la structure des documents. Portée : tout
  l'espace, un sous-arbre ou un voisinage. Les tailles sont comptées en tokens
  avec le tokenizer indiqué dans le manifest (o200k_base).
- **Connecter un assistant IA (MCP)…** : permet à un assistant compatible
  MCP (Claude Code, Gemini CLI, Codex, Claude Desktop, Cursor, VS Code)
  de consulter l'espace —
  recherche, lecture des nœuds et documents, exploration du graphe — et, si
  la case « Autoriser l'assistant à enrichir l'espace » est cochée, de
  l'alimenter : créer des nœuds, ajouter ou compléter des documents, relier
  des nœuds, poser des tags. L'assistant ne supprime jamais rien. Choisissez
  votre assistant dans la liste : la fenêtre affiche la commande à lancer
  (`claude mcp add …`, `gemini mcp add …`, `codex mcp add …`) ou le bloc JSON
  à coller dans son fichier de configuration, avec l'endroit où le mettre, et
  le fichier d'instructions du projet à compléter (`CLAUDE.md`, `GEMINI.md`,
  `AGENTS.md`…). Node.js 22.13 ou plus récent doit être
  installé. Après une mise à jour de Nodal ou un déplacement du fichier,
  refaites la configuration.
- **Travailler à deux** : Nodal peut rester ouvert pendant que l'assistant
  travaille. L'affichage se met à jour dans la seconde qui suit chacune de
  ses écritures ; si vous êtes en train de taper, la mise à jour attend que
  votre saisie soit enregistrée. Si vous modifiez le même texte que
  l'assistant au même moment, votre version est conservée — la sienne reste
  dans le journal.
- **Activité IA** (en haut de l'espace) : liste les modifications faites par
  l'assistant, avec la date et le nom de l'assistant. « Afficher » ouvre le
  nœud concerné, « Annuler » rétablit l'état d'avant. L'annulation est
  refusée si l'élément a été retouché depuis (par vous ou par l'assistant) :
  annulez d'abord les modifications les plus récentes.
- **Pastille « IA »** : un nœud (à côté de son type) ou une relation créés par
  l'assistant portent une pastille « IA » ; survolez-la pour voir quel
  assistant l'a créé et quand. L'assistant voit la même information et sait
  qu'un élément qu'il a ajouté reste à valider. Dans l’arborescence, ces nœuds
  portent la marque « IA ».
- **Valider** ce qu’a ajouté l’IA : bouton **Valider** de la fiche du nœud,
  menu contextuel de l’arborescence, ou **Valider (N)** après une sélection
  multiple dans le graphe. Le nœud n’est plus signalé comme ajouté par l’IA
  (y compris pour l’assistant) ; l’entrée reste dans « Activité IA »
  (« validée le … ») et peut toujours être annulée. Le filtre « Ajouté par
  l’IA, non validé » du graphe montre ce qui reste à relire.
- **Sujets à documenter** : quand une recherche de l'assistant ne trouve
  rien, Nodal note la requête (seulement la requête, sa date et le nombre de
  fois ; jamais en lecture seule). Bouton **Santé** en haut de l'espace, ou
  palette « Sujets à documenter… » : **Créer un nœud** propose un nouveau
  nœud à ce titre (le sujet quitte la liste une fois le nœud créé),
  **Ignorer** l'écarte. L'assistant voit aussi cette liste (outil
  `nodal_health`) quand vous lui demandez d'enrichir la base.
- **Consulter Nodal d'abord** : la fenêtre « Connecter un assistant IA »
  fournit un bloc de consignes à coller dans le fichier d'instructions de
  votre projet (`CLAUDE.md` pour Claude Code, `AGENTS.md` pour Codex ou
  Cursor). L'assistant interroge alors Nodal avant de parcourir les fichiers
  ou de répondre de mémoire.
- **Fichiers du code** : avant de modifier des fichiers, l'assistant demande
  à Nodal les nœuds qui les documentent (outil `nodal_for_files`) ; après,
  il met ces nœuds à jour et y ancre les nouveaux fichiers (opération
  `anchor` de `nodal_apply`, journalisée et annulable comme les autres). Les
  nœuds possiblement obsolètes lui sont signalés dans les réponses (champ
  `stale`).

### Importer un dossier Markdown ou un coffre Obsidian

Menu **Importer / exporter ▾** → **Importer un dossier Markdown /
Obsidian…** (ou la palette). Choisissez le dossier : Nodal le lit, sans rien
écrire, et affiche un aperçu (dossiers, notes, liens, pièces jointes, liens
non résolus, éléments ignorés). **Importer** :

- fait d’abord une sauvegarde de l’espace à côté de son fichier
  (`<nom>-avant-import-<date>.nodal`) ;
- crée un nœud racine au nom du dossier ; chaque sous-dossier contenant des
  notes devient un nœud, chaque note `.md` un nœud avec son document ;
- reprend du front-matter le titre, le type (`type: procedure`,
  `composant`…), le résumé (`summary` ou `description`), les tags et les
  alias (pour résoudre les liens) ;
- convertit les liens `[[Note]]`, `[[Note#Titre|texte]]`, `[texte](note.md)`
  en liens Nodal, avec leur relation « est lié à » ; un lien vers une note
  absente mais vers un nœud existant de même titre le vise ; les autres
  restent des liens cassés, signalés par la santé de la base ;
- importe les fichiers référencés (`![[image.png]]`, `![](assets/a.pdf)`)
  comme pièces jointes de la note.

Les fichiers sont lus comme des données, jamais exécutés ; les liens
symboliques, les dossiers cachés (`.obsidian`, `.git`) et les notes non
UTF-8 sont ignorés et listés dans le rapport.

## 8. Préférences

Les préférences concernent l'application, quel que soit l'espace ouvert. On
les ouvre avec **Ctrl + ,** ou le bouton **Préférences** de la barre d'état ;
chaque changement s'applique et s'enregistre aussitôt.

- **Thème** : Système (suit le mode clair ou sombre de Windows), Clair ou
  Sombre.
- **Couleur d'accent** : la couleur des boutons principaux, de la sélection et
  des liens.
- **Densité** : Confortable, ou Compacte pour afficher plus d'éléments.
- **Taille du texte** : de 80 % à 150 %, aussi avec Ctrl + = (agrandir),
  Ctrl + - (réduire) et Ctrl + 0 (rétablir).
- **Vue à l'ouverture d'un espace** : Graphe ou Documents.
- **Rouvrir le dernier espace** au démarrage.
- **Aide des gestes** dans la barre d'outils du graphe, à masquer une fois
  les gestes connus.
- **Lier le repli de l’arbre et du graphe** (désactivé par défaut) : déplier
  ou replier un nœud dans l’arborescence fait de même dans le graphe, et
  inversement.
- **Capture rapide** : activer ou non le raccourci global, et le choisir
  (cliquez sur le raccourci, puis appuyez sur la combinaison voulue ; il
  faut Ctrl ou Alt, sauf pour une touche de fonction).

La fenêtre retrouve aussi sa taille et sa position d'une session à l'autre.
« Rétablir les valeurs par défaut » remet toutes les préférences à zéro.

## 9. Raccourcis clavier

| Raccourci       | Action                                                 |
| --------------- | ------------------------------------------------------ |
| Ctrl + P        | palette de commandes (nœuds et actions)                |
| Ctrl + Maj + P  | palette de commandes, actions seules                   |
| Alt + ← / →     | nœud précédent / suivant (aussi boutons de la souris)  |
| Ctrl + N        | nouveau sous-nœud du nœud sélectionné                  |
| Ctrl + Maj + N  | nouveau nœud racine                                    |
| Ctrl + F        | rechercher                                             |
| Ctrl + S        | enregistrer immédiatement                              |
| Ctrl + A        | sélectionner tous les nœuds affichés (graphe)          |
| Échap           | vider la sélection ou la recherche, fermer une fenêtre |
| F2              | renommer le nœud sélectionné                           |
| Suppr           | supprimer le nœud sélectionné (arborescence)           |
| H               | masquer / afficher le nœud dans le graphe (arbre)      |
| Menu, Maj+F10   | menu contextuel du nœud (arborescence)                 |
| F1              | aide                                                   |
| Ctrl + ,        | préférences                                            |
| Ctrl + = / -    | agrandir / réduire le texte (Ctrl + 0 : rétablir)      |
| Ctrl+Maj+Espace | capture rapide (global, réglable dans les préférences) |

## 10. Dépannage

- **« Le fichier de l'espace est verrouillé »** : le fichier est ouvert par un
  autre programme ou une autre fenêtre. Fermez-le puis réessayez.
- **« Espace disque insuffisant »** : libérez de la place ; les modifications
  non enregistrées restent dans la fenêtre et seront écrites ensuite.
- **« Ce fichier n'est pas un espace Nodal »** : le fichier choisi n'a pas été
  créé par Nodal.
- **« Créé par une version plus récente de Nodal »** : mettez Nodal à jour.
- **Le graphe ne s'affiche pas** (WebGL indisponible) : utilisez la vue
  Documents et l'arborescence ; toutes les fonctions y restent accessibles.
- Après un arrêt brutal, des fichiers `-wal` et `-shm` peuvent rester à côté du
  `.nodal` : ils sont fusionnés automatiquement à la prochaine ouverture. Ne
  les supprimez pas.
