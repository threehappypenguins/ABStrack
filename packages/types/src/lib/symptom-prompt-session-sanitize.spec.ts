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

  it('sanitizeSymptomPromptAnswerEntry accepts photo local capture refs', () => {
    expect(
      sanitizeSymptomPromptAnswerEntry({
        type: 'photo',
        value: {
          localUri: 'file:///tmp/symptom.jpg',
          capturedAt: '2026-04-27T12:00:00.000Z',
        },
      }),
    ).toEqual({
      type: 'photo',
      value: {
        localUri: 'file:///tmp/symptom.jpg',
        capturedAt: '2026-04-27T12:00:00.000Z',
      },
    });
  });

  it('sanitizeSymptomPromptAnswerEntry trims photo localUri and capturedAt', () => {
    expect(
      sanitizeSymptomPromptAnswerEntry({
        type: 'photo',
        value: {
          localUri: '  file:///tmp/symptom.jpg  ',
          capturedAt: '  2026-04-27T12:00:00.000Z  ',
        },
      }),
    ).toEqual({
      type: 'photo',
      value: {
        localUri: 'file:///tmp/symptom.jpg',
        capturedAt: '2026-04-27T12:00:00.000Z',
      },
    });
  });

  it('sanitizeSymptomPromptAnswerEntry rejects photo refs with invalid capturedAt', () => {
    expect(
      sanitizeSymptomPromptAnswerEntry({
        type: 'photo',
        value: {
          localUri: 'file:///tmp/symptom.jpg',
          capturedAt: 'not-a-date',
        },
      }),
    ).toBeNull();
  });

  it('sanitizeSymptomPromptAnswerEntry accepts video local capture refs', () => {
    expect(
      sanitizeSymptomPromptAnswerEntry({
        type: 'video',
        value: {
          localUri: 'blob:https://example.test/abc',
          durationMs: 12000,
          capturedAt: '2026-04-27T12:00:00.000Z',
        },
      }),
    ).toEqual({
      type: 'video',
      value: {
        localUri: 'blob:https://example.test/abc',
        durationMs: 12000,
        capturedAt: '2026-04-27T12:00:00.000Z',
      },
    });
  });

  it('sanitizeSymptomPromptAnswerEntry trims video localUri and capturedAt', () => {
    expect(
      sanitizeSymptomPromptAnswerEntry({
        type: 'video',
        value: {
          localUri: '  blob:https://example.test/abc  ',
          durationMs: 12000,
          capturedAt: '  2026-04-27T12:00:00.000Z  ',
        },
      }),
    ).toEqual({
      type: 'video',
      value: {
        localUri: 'blob:https://example.test/abc',
        durationMs: 12000,
        capturedAt: '2026-04-27T12:00:00.000Z',
      },
    });
  });

  it('sanitizeSymptomPromptAnswerEntry rejects video refs with invalid duration range', () => {
    expect(
      sanitizeSymptomPromptAnswerEntry({
        type: 'video',
        value: {
          localUri: 'blob:https://example.test/abc',
          durationMs: -1,
          capturedAt: '2026-04-27T12:00:00.000Z',
        },
      }),
    ).toBeNull();
    expect(
      sanitizeSymptomPromptAnswerEntry({
        type: 'video',
        value: {
          localUri: 'blob:https://example.test/abc',
          durationMs: 16000,
          capturedAt: '2026-04-27T12:00:00.000Z',
        },
      }),
    ).toBeNull();
  });

  it('sanitizeSymptomPromptAnswerEntry rejects video refs with invalid capturedAt', () => {
    expect(
      sanitizeSymptomPromptAnswerEntry({
        type: 'video',
        value: {
          localUri: 'blob:https://example.test/abc',
          durationMs: 1000,
          capturedAt: 'not-a-date',
        },
      }),
    ).toBeNull();
  });
});
