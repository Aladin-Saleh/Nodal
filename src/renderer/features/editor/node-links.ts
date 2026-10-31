import { createContext, useContext } from 'react';
import {
  createLinkResolver,
  type LinkResolver,
} from '../../../shared/wiki-links';

/** Nœud proposé par l'autocomplétion des liens [[...]]. */
export interface LinkNode {
  id: string;
  title: string;
  /** « Racine › Parent » ; vide pour une racine. */
  path: string;
}

/**
 * Nœuds de l'espace ouvert pour les liens [[...]] : autocomplétion dans
 * l'éditeur, titre affiché dans l'éditeur et l'aperçu, ouverture au clic.
 */
export interface NodeLinks {
  nodes: readonly LinkNode[];
  resolver: LinkResolver;
  open(id: string): void;
  /** Un enregistrement a changé les relations issues des liens. */
  onLinksChanged(): void;
  /** Un document a été enregistré (suggestions de liens à relire). */
  onDocumentSaved(): void;
}

export const NodeLinksContext = createContext<NodeLinks>({
  nodes: [],
  resolver: createLinkResolver([]),
  open: () => undefined,
  onLinksChanged: () => undefined,
  onDocumentSaved: () => undefined,
});

export const useNodeLinks = () => useContext(NodeLinksContext);
