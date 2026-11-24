/** Confiance (échelle fixe) et preuves d'une relation. */
export const CONFIDENCES = ['uncertain', 'probable', 'certain'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  certain: 'certaine',
  probable: 'probable',
  uncertain: 'incertaine',
};

export const EVIDENCE_SOURCE_MAX_LENGTH = 500;
export const EVIDENCE_QUOTE_MAX_LENGTH = 1000;
export const EVIDENCE_MAX_PER_EDGE = 20;

export interface EdgeEvidence {
  id: string;
  /** Fichier (avec ligne éventuelle), document, adresse… */
  source: string;
  quote: string | null;
  /**
   * Citation retrouvée dans le fichier (`true`), absente (`false`), ou pas
   * vérifiable (`null`).
   */
  verified: boolean | null;
  client: string | null;
  createdAt: string;
}

/** Rang d'une confiance ; sans avis : sous la plus faible. */
export const confidenceRank = (value: Confidence | null | undefined): number =>
  value ? CONFIDENCES.indexOf(value) : -1;

/**
 * Confiance retenue pour une relation ajoutée par un assistant : « certain »
 * se prouve par une source, et une citation introuvable ne prouve rien.
 */
export function grantedConfidence(
  asked: Confidence | null,
  evidence: { verified: boolean | null } | null,
): Confidence | null {
  if (asked !== 'certain') return asked;
  return evidence && evidence.verified !== false ? 'certain' : 'probable';
}
