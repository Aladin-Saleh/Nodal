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
- **Disposer** : relance la disposition automatique.
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

## 8. Raccourcis clavier

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

## 9. Dépannage

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
