import { SYMPTOM_RESPONSE_TYPES } from '@abstrack/types';
import { getSymptomResponseTypeLabel } from './response-type-labels';

describe('getSymptomResponseTypeLabel', () => {
  it('returns a non-empty label for every SymptomResponseType', () => {
    for (const t of SYMPTOM_RESPONSE_TYPES) {
      expect(getSymptomResponseTypeLabel(t).length).toBeGreaterThan(0);
    }
  });
});
