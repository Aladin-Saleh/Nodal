import { describe, expect, it } from 'vitest';
import {
  csvRecords,
  detectDelimiter,
  parseCsv,
  parseCsvRecord,
} from '../../src/shared/csv';

describe('csv', () => {
  it('sépare les enregistrements sans couper un champ entre guillemets', () => {
    expect(csvRecords('a,b\r\n1,"x\ny"\n\n2,z\n')).toEqual([
      'a,b',
      '1,"x\ny"',
      '2,z',
    ]);
  });

  it('détecte la virgule, le point-virgule ou la tabulation', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('nom;prix\n"a,b";3,5')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('seule')).toBe(',');
  });

  it('lit les guillemets doublés et les champs vides', () => {
    expect(parseCsvRecord('"dit ""oui""",,fin', ',')).toEqual([
      'dit "oui"',
      '',
      'fin',
    ]);
  });

  it('renvoie le tableau complet', () => {
    expect(parseCsv('nom;rôle\nAda;"dev;lead"')).toEqual({
      delimiter: ';',
      rows: [
        ['nom', 'rôle'],
        ['Ada', 'dev;lead'],
      ],
    });
  });
});
