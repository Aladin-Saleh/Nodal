/**
 * Masquage des secrets reconnaissables à leur forme (clés d'API, jetons, clés
 * privées, mot de passe dans une URL). Réduit le risque, sans garantie : un
 * mot de passe en clair dans une phrase n'a pas de forme.
 */
export const REDACTED = '[masqué]';

/** Formes qui commencent un mot (une lettre ou un chiffre avant les exclut). */
const TOKENS = [
  '(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])',
  'gh[pousr]_[A-Za-z0-9]{36,}',
  'github_pat_[A-Za-z0-9_]{22,}',
  'xox[abeoprs]-[A-Za-z0-9-]{10,}',
  '[sr]k_(?:live|test)_[A-Za-z0-9]{10,}',
  // Un chiffre exigé : « sk-learn-compatible-… » n'est pas une clé.
  'sk-(?:ant-|proj-)?(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}',
  'AIza[0-9A-Za-z_-]{35}',
  'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{2,}\\.[A-Za-z0-9_-]{10,}',
];

const SECRET = new RegExp(
  [
    // Jusqu'à la ligne END, ou la fin du texte si le bloc est coupé.
    '-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----' +
      '(?:[\\s\\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|[\\s\\S]*)',
    `(?<![A-Za-z0-9])(?:${TOKENS.join('|')})`,
    '(?<=\\bBearer )[A-Za-z0-9._~+/=-]{16,}',
    // schéma://utilisateur:motdepasse@hôte
    '(?<=:\\/\\/[^\\s/@:]{0,100}:)[^\\s@/]{1,200}(?=@[^\\s@/]+)',
  ].join('|'),
  'gu',
);

export const redactSecrets = (text: string) => text.replace(SECRET, REDACTED);
