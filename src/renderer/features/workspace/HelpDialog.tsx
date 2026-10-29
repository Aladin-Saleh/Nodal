import { Modal } from '../../components/Modal';

const GRAPH_GESTURES: [string, string][] = [
  ['Clic sur un nœud', 'sélectionner, zoomer et afficher ses documents'],
  ['Double-clic sur un nœud', 'ouvrir sa fiche (vue Documents)'],
  ['Double-clic dans le vide', 'créer un nœud à cet endroit'],
  ['Glisser d’un nœud à un autre', 'créer une relation'],
  ['Maj + glisser un nœud', 'le déplacer'],
  ['Ctrl + clic, Ctrl + A', 'sélection multiple, puis actions groupées'],
  ['Glisser dans le vide / clic droit', 'pivoter / déplacer la vue'],
  ['Molette, ⤢', 'zoomer, recadrer'],
];

const SHORTCUTS: [string, string][] = [
  ['Ctrl + N', 'nouveau sous-nœud du nœud sélectionné'],
  ['Ctrl + Maj + N', 'nouveau nœud racine'],
  ['Ctrl + F', 'rechercher'],
  ['Ctrl + S', 'enregistrer immédiatement'],
  ['Échap', 'vider la sélection ou la recherche, fermer une fenêtre'],
  ['F2 / Suppr', 'renommer / supprimer le nœud (arborescence)'],
  ['F1', 'cette aide'],
];

/** Aide intégrée (§7.1) : gestes du graphe et raccourcis clavier. */
export function HelpDialog({ onClose }: { onClose(): void }) {
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
      <h3>Clavier</h3>
      <dl className="help-list">
        {SHORTCUTS.map(([keys, effect]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{effect}</dd>
          </div>
        ))}
      </dl>
      <p className="muted">
        Documents : écrivez [[Titre d’un nœud]] dans un document Markdown pour
        créer un lien interne. Le guide complet est fourni avec l’application
        (docs/guide-utilisateur.md).
      </p>
    </Modal>
  );
}
