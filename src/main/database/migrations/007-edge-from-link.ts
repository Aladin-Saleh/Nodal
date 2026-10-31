import type { Migration } from '../migrations';

/**
 * Relations issues d'un lien [[...]] d'un document : créées et retirées
 * automatiquement avec le lien (`from_link = 1`). Une relation créée à la
 * main (`from_link = 0`) n'est jamais touchée par cette synchronisation.
 */
export const migration007: Migration = {
  version: 7,
  name: 'edge-from-link',
  sql: /* sql */ `
ALTER TABLE edge ADD COLUMN from_link INTEGER NOT NULL DEFAULT 0 CHECK (from_link IN (0, 1));
`,
};
