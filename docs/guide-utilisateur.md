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
  de la hiérarchie.
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
  parent, changer le type, supprimer.

## 4. Nœuds et hiérarchie

- **Arborescence** (panneau gauche) : **+ Racine**, **+ Enfant**, ↑ / ↓ pour
  réordonner. Clavier : flèches pour parcourir, F2 pour renommer, Suppr pour
  supprimer.
- **Panneau de propriétés** (droite) : type, **parent** (pour passer un nœud
  en racine ou le rattacher à un autre), résumé, couleur, documents,
  relations, tags, pièces jointes.
- **Supprimer un nœud** : une confirmation indique ce qui sera supprimé. Si le
  nœud a des enfants, vous choisissez de les **remonter d'un niveau** ou de
  **supprimer tout le sous-arbre**.
- **Dupliquer** : copie le nœud avec ses documents, tags et pièces jointes
  (les relations ne sont pas copiées).

## 5. Documents

Un nœud contient une liste ordonnée de documents, chacun d'un seul type :
**Markdown**, **texte**, **JSON**, **code** (avec langage) ou **diagramme
Mermaid**. L'enregistrement est automatique.

- **Markdown** : modes _Édition_, _Côte à côte_, _Aperçu_. Écrivez
  `[[Titre d'un nœud]]` pour créer un lien vers un autre nœud. Les liens web
  s'ouvrent dans votre navigateur.
- **Code** : coloration selon le langage, numéros de ligne, bouton
  **Copier**. Aucune exécution n'est possible.
- **JSON** : les erreurs de syntaxe sont signalées sans bloquer la saisie ;
  **Mettre en forme** réindente le contenu sur demande uniquement.
- **Mermaid** : le diagramme est rendu localement ; en cas d'erreur de
  syntaxe, le message s'affiche et le dernier rendu valide reste visible.

**Pièces jointes** : _Joindre des fichiers…_ dans le panneau de propriétés
(taille maximale réglable dans les Paramètres). Une pièce jointe n'est jamais
ouverte par Nodal : utilisez **⤓** pour en enregistrer une copie.

## 6. Recherche

Barre **Rechercher** en haut (Ctrl + F). La recherche porte sur les titres,
résumés et contenus des documents, **code compris**, sans tenir compte des
accents ni des majuscules. Avec plusieurs mots, un nœud est trouvé s'il les
contient tous (dans son titre, son résumé ou ses documents).

Les nœuds trouvés ressortent dans le graphe et l'arborescence. Un clic sur un
résultat sélectionne le nœud ; un clic sur un extrait de document ouvre ce
document. Échap efface la recherche.

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
  MCP (Claude Code, Claude Desktop, Cursor…) de consulter l'espace —
  recherche, lecture des nœuds et documents, exploration du graphe — et, si
  la case « Autoriser l'assistant à enrichir l'espace » est cochée, de
  l'alimenter : créer des nœuds, ajouter ou compléter des documents, relier
  des nœuds, poser des tags. L'assistant ne supprime jamais rien. La fenêtre
  donne la commande `claude mcp add …` et le bloc JSON à copier dans la
  configuration de l'assistant. Node.js 22.13 ou plus récent doit être
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
  qu'un élément qu'il a ajouté reste à valider.
- **Consulter Nodal d'abord** : la fenêtre « Connecter un assistant IA »
  fournit un bloc de consignes à coller dans le fichier d'instructions de
  votre projet (`CLAUDE.md` pour Claude Code, `AGENTS.md` pour Codex ou
  Cursor). L'assistant interroge alors Nodal avant de parcourir les fichiers
  ou de répondre de mémoire.

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

La fenêtre retrouve aussi sa taille et sa position d'une session à l'autre.
« Rétablir les valeurs par défaut » remet toutes les préférences à zéro.

## 9. Raccourcis clavier

| Raccourci      | Action                                                 |
| -------------- | ------------------------------------------------------ |
| Ctrl + N       | nouveau sous-nœud du nœud sélectionné                  |
| Ctrl + Maj + N | nouveau nœud racine                                    |
| Ctrl + F       | rechercher                                             |
| Ctrl + S       | enregistrer immédiatement                              |
| Ctrl + A       | sélectionner tous les nœuds affichés (graphe)          |
| Échap          | vider la sélection ou la recherche, fermer une fenêtre |
| F2             | renommer le nœud sélectionné                           |
| Suppr          | supprimer le nœud sélectionné (arborescence)           |
| F1             | aide                                                   |
| Ctrl + ,       | préférences                                            |
| Ctrl + = / -   | agrandir / réduire le texte (Ctrl + 0 : rétablir)      |

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
