import { Modal } from '../../components/Modal';
import { DocumentEditor } from './DocumentEditor';

export interface DocumentEditorDialogProps {
  documentId: string;
  /** Change après une modification externe : l'éditeur est rechargé. */
  revision?: number;
  /** Titre ou langage modifié : rafraîchir les listes de documents. */
  onChanged(): void;
  onClose(): void;
}

/**
 * Édition d'un document par-dessus la vue courante (graphe ou recherche).
 * Les modifications sont enregistrées automatiquement, y compris à la
 * fermeture.
 */
export function DocumentEditorDialog({
  documentId,
  revision = 0,
  onChanged,
  onClose,
}: DocumentEditorDialogProps) {
  return (
    <Modal
      title="Document"
      size="large"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <DocumentEditor
        key={`${documentId}:${revision}`}
        documentId={documentId}
        onMetadataChanged={onChanged}
      />
    </Modal>
  );
}
