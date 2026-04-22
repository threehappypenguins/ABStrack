import { describe, expect, it } from 'vitest';
import { bacReadingSuggestsAbsEpisode } from './episode-bac-suggestion.js';

describe('bacReadingSuggestsAbsEpisode', () => {
  it('returns false for empty rows', () => {
    expect(bacReadingSuggestsAbsEpisode([])).toBe(false);
  });

  it('returns true when a bac row has value_numeric > 0', () => {
    expect(
      bacReadingSuggestsAbsEpisode([
        { marker_kind: 'bac', value_numeric: 0.02 },
        { marker_kind: 'heart_rate', value_numeric: 80 },
      ]),
    ).toBe(true);
  });

  it('returns false when bac is zero or null', () => {
    expect(
      bacReadingSuggestsAbsEpisode([
        { marker_kind: 'bac', value_numeric: 0 },
        { marker_kind: 'bac', value_numeric: null },
      ]),
    ).toBe(false);
  });
});
