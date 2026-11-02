/**
 * Lecture des documents CSV (RFC 4180) : champs entre guillemets, guillemets
 * doublés, sauts de ligne dans un champ. Séparateur détecté sur la première
 * ligne (virgule, point-virgule — Excel en français — ou tabulation).
 * Logique pure, partagée par l'aperçu et le découpage pour un LLM.
 */

export const CSV_DELIMITERS = [',', ';', '\t'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/**
 * Lignes brutes du fichier (un enregistrement par élément) : un saut de
 * ligne entre guillemets n'en termine pas une. Lignes vides écartées.
 */
export function csvRecords(text: string): string[] {
  const records: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') quoted = !quoted;
    else if (char === '\n' && !quoted) {
      records.push(text.slice(start, i).replace(/\r$/, ''));
      start = i + 1;
    }
  }
  records.push(text.slice(start).replace(/\r$/, ''));
  return records.filter((record) => record.trim().length > 0);
}

/** Séparateur le plus fréquent hors guillemets dans le premier enregistrement. */
export function detectDelimiter(text: string): CsvDelimiter {
  const first = csvRecords(text)[0] ?? '';
  let best: CsvDelimiter = ',';
  let bestCount = 0;
  for (const delimiter of CSV_DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const char of first) {
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** Champs d'un enregistrement brut. */
export function parseCsvRecord(
  record: string,
  delimiter: CsvDelimiter,
): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < record.length; i += 1) {
    const char = record[i]!;
    if (quoted) {
      if (char === '"' && record[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      fields.push(field);
      field = '';
    } else field += char;
  }
  fields.push(field);
  return fields.map((value) => value.replace(/\r\n/g, '\n'));
}

/** Tableau complet : première ligne = en-tête. */
export function parseCsv(text: string): {
  delimiter: CsvDelimiter;
  rows: string[][];
} {
  const delimiter = detectDelimiter(text);
  return {
    delimiter,
    rows: csvRecords(text).map((record) => parseCsvRecord(record, delimiter)),
  };
}
