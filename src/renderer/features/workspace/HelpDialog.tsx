import { Modal } from '../../components/Modal';
import { shortcutLabel, type AppAction } from '../commands/actions';

const GRAPH_GESTURES: [string, string][] = [
  ['Clic sur un nœud', 'sélectionner, zoomer et afficher ses documents'],
  ['Double-clic sur un nœud', 'ouvrir sa fiche (vue Documents)'],
  ['Double-clic dans le vide', 'créer un nœud à cet endroit'],
  ['Glisser d’un nœud à un autre', 'créer une relation'],
  ['Maj + glisser un nœud', 'le déplacer'],
  ['Ctrl + clic, Ctrl + A', 'sélection multiple, puis actions groupées'],
  ['Glisser dans le vide / clic droit', 'pivoter / déplacer la vue'],
  ['Molette, ⤢', 'zoomer, recadrer'],
  ['Sélecteur de vue, Vues ▾', 'appliquer ou enregistrer une vue nommée'],
];

const TREE_GESTURES: [string, string][] = [
  ['Glisser un nœud', 'le placer avant, après ou dans un autre nœud'],
  ['Clic droit', 'menu contextuel du nœud'],
  ['Œil (au survol)', 'masquer le nœud et ses descendants dans le graphe'],
  ['Alt + clic sur l’œil', 'n’afficher que cette branche (ou en sortir)'],
  ['Marque « MAJ »', 'des fichiers du code ancrés ont changé depuis'],
];

/** Touches propres à un panneau, hors du registre des actions. */
const CONTEXT_KEYS: [string, string][] = [
  ['Échap', 'vider la sélection ou la recherche, fermer une fenêtre'],
  ['Boutons 4 / 5 de la souris', 'nœud précédent / suivant'],
  ['F2 / Suppr', 'renommer / supprimer le nœud (arborescence)'],
  ['H', 'masquer / afficher le nœud dans le graphe (arborescence)'],
  ['Menu, Maj + F10', 'menu contextuel du nœud (arborescence)'],
  [
    'Ctrl + = / Ctrl + - / Ctrl + 0',
    'agrandir, réduire, rétablir la taille du texte',
  ],
];

/** Raccourcis du registre des actions, puis touches propres aux panneaux. */
export function shortcutList(
  actions: readonly AppAction[],
): [string, string][] {
  const fromActions = actions.flatMap((action): [string, string][] => {
    const keys = shortcutLabel(action);
    return keys ? [[keys, action.label]] : [];
  });
  return [...fromActions, ...CONTEXT_KEYS];
}

/** Aide intégrée (§7.1) : gestes du graphe et raccourcis clavier. */
export function HelpDialog({
  actions,
  onClose,
}: {
  actions: readonly AppAction[];
  onClose(): void;
}) {
  return (
    <Modal
      title="Aide"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <h3>Graphe</h3>
      <dl className="help-list">
        {GRAPH_GESTURES.map(([gesture, effect]) => (
          <div key={gesture}>
            <dt>{gesture}</dt>
            <dd>{effect}</dd>
          </div>
        ))}
      </dl>
      <h3>Arborescence</h3>
      <dl className="help-list">
        {TREE_GESTURES.map(([gesture, effect]) => (
          <div key={gesture}>
            <dt>{gesture}</dt>
            <dd>{effect}</dd>
          </div>
        ))}
      </dl>
      <h3>Clavier</h3>
      <dl className="help-list">
        {shortcutList(actions).map(([keys, effect]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{effect}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Ctrl + P ouvre la palette de commandes : tapez quelques lettres du titre
        d’un nœud (ou de son chemin) pour l’ouvrir, ou le nom d’une action.
        Documents : tapez [[ dans un document Markdown pour choisir un nœud et
        créer un lien interne (il suit les renommages et crée une relation « est
        lié à »). « Mentionné dans » liste les documents qui citent le nœud.
        Fichiers du code : déclarez un dossier de code dans les paramètres de
        l’espace, puis ancrez un nœud à des fichiers (src/mcp/** par exemple)
        depuis son panneau ; Nodal signale « possiblement obsolète » quand ils
        changent après la dernière mise à jour du nœud ; un clic sur un fichier
        l’affiche en lecture seule. Terminal : Ctrl + J (ou le bouton « &gt;_
        »), dans le dossier de code de l’espace ; « + » ouvre un autre terminal,
        « ▾ » choisit son type. Les bords des panneaux se font glisser pour les
        redimensionner (double-clic : taille par défaut). Capture rapide : Ctrl
        + Maj + Espace (réglable dans les préférences), même quand Nodal n’est
        pas au premier plan, range un titre et une note dans la « Boîte de
        réception » ; glissez ensuite chaque capture à sa place. Modèles de
        documents : choisissez un modèle (Procédure, Composant, Donnée,
        Décision) en créant un nœud ou un document ; modifiez-les depuis la
        palette (« Modèles de documents… »). Import Markdown / Obsidian : menu «
        Espace », aperçu puis import sous une nouvelle racine, après une
        sauvegarde. Le guide complet est fourni avec l’application
        (docs/guide-utilisateur.md).
      </p>
    </Modal>
  );
}
