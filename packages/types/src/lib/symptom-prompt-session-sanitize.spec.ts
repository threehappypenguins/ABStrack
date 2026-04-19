import { describe, expect, it } from 'vitest';
import {
  sanitizeSymptomPromptActiveIndex,
  sanitizeSymptomPromptAnswerEntry,
  sanitizeSymptomPromptAnswers,
} from './symptom-prompt-session-sanitize.js';

describe('symptom-prompt-session-sanitize', () => {
  it('sanitizeSymptomPromptActiveIndex floors and rejects non-finite', () => {
    expect(sanitizeSymptomPromptActiveIndex(2.7)).toBe(2);
    expect(sanitizeSymptomPromptActiveIndex(NaN)).toBeNull();
    expect(sanitizeSymptomPromptActiveIndex('1')).toBeNull();
  });

  it('sanitizeSymptomPromptAnswerEntry keeps severity 1–5 and resets out-of-range to null value', () => {
    expect(
      sanitizeSymptomPromptAnswerEntry({ type: 'severity_scale', value: 3 }),
    ).toEqual({ type: 'severity_scale', value: 3 });
    expect(
      sanitizeSymptomPromptAnswerEntry({ type: 'severity_scale', value: 99 }),
    ).toEqual({ type: 'severity_scale', value: null });
  });

  it('sanitizeSymptomPromptAnswers skips unsafe keys', () => {
    const answers = JSON.parse(
      '{"__proto__":{"type":"yes_no","value":true},"legit":{"type":"yes_no","value":false}}',
    );
    expect(sanitizeSymptomPromptAnswers(answers)).toEqual({
      legit: { type: 'yes_no', value: false },
    });
  });
});
