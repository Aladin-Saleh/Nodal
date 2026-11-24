import { describe, expect, it } from 'vitest';
import { REDACTED, redactSecrets } from '../../src/shared/secrets';

describe('redactSecrets', () => {
  it.each([
    ['clé AWS', `AKIA${'A1'.repeat(8)}`],
    ['jeton GitHub', `ghp_${'a1B2'.repeat(10)}`],
    ['clé d’API', `sk-ant-${'a1b2'.repeat(8)}`],
    [
      'clé privée',
      '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----',
    ],
  ])('masque : %s', (_label, secret) => {
    const text = redactSecrets(`avant ${secret} après`);
    expect(text).toBe(`avant ${REDACTED} après`);
  });

  it('ne masque que le mot de passe d’une URL et le jeton Bearer', () => {
    expect(redactSecrets('postgres://app:s3cret@db:5432/x')).toBe(
      `postgres://app:${REDACTED}@db:5432/x`,
    );
    expect(redactSecrets('Authorization: Bearer abcdef0123456789xyz')).toBe(
      `Authorization: Bearer ${REDACTED}`,
    );
  });

  it('laisse le texte ordinaire', () => {
    const text =
      'Les tokens et mots de passe : voir https://exemple.fr:8080/a, sk-learn-compatible-estimator-api.';
    expect(redactSecrets(text)).toBe(text);
  });
});
