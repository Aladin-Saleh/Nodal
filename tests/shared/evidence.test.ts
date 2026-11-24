import { expect, it } from 'vitest';
import { confidenceRank, grantedConfidence } from '../../src/shared/evidence';

it('« certain » se prouve', () => {
  expect(grantedConfidence('certain', null)).toBe('probable');
  expect(grantedConfidence('certain', { verified: false })).toBe('probable');
  expect(grantedConfidence('certain', { verified: null })).toBe('certain');
  expect(grantedConfidence('certain', { verified: true })).toBe('certain');
  expect(grantedConfidence('uncertain', { verified: true })).toBe('uncertain');
  expect(grantedConfidence(null, { verified: true })).toBeNull();
  expect(confidenceRank(null)).toBeLessThan(confidenceRank('uncertain'));
});
