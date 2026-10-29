import type { Migration } from '../migrations';

/** Vue graphe en 3D : troisième coordonnée d'affichage, facultative. */
export const migration002: Migration = {
  version: 2,
  name: 'node-position-z',
  sql: /* sql */ `
ALTER TABLE node ADD COLUMN position_z REAL;
`,
};
