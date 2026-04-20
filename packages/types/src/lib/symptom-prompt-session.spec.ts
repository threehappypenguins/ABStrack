import { describe, expect, it } from 'vitest';
import {
  createDefaultSymptomPromptAnswer,
  createInitialSymptomPromptSession,
  symptomPromptAnswerHasValue,
} from './symptom-prompt-session.js';
import type { SymptomResponseType } from './types.js';

describe('symptom-prompt-session', () => {
  it('createInitialSymptomPromptSession starts at first step with no answers', () => {
    const s = createInitialSymptomPromptSession();
    expect(s.activeIndex).toBe(0);
    expect(s.answers).toEqual({});
  });

  describe('createDefaultSymptomPromptAnswer', () => {
    const cases: {
      type: SymptomResponseType;
      expected: ReturnType<typeof createDefaultSymptomPromptAnswer>;
    }[] = [
      { type: 'yes_no', expected: { type: 'yes_no', value: null } },
      {
        type: 'severity_scale',
        expected: { type: 'severity_scale', value: null },
      },
      { type: 'free_text', expected: { type: 'free_text', value: '' } },
      { type: 'photo', expected: { type: 'photo', value: null } },
      { type: 'video', expected: { type: 'video', value: null } },
    ];

    it.each(cases)('returns empty shape for $type', ({ type, expected }) => {
      expect(createDefaultSymptomPromptAnswer(type)).toEqual(expected);
    });
  });

  describe('symptomPromptAnswerHasValue', () => {
    it('returns false for undefined', () => {
      expect(symptomPromptAnswerHasValue(undefined)).toBe(false);
    });

    it('yes_no: false when null, true when boolean', () => {
      expect(symptomPromptAnswerHasValue({ type: 'yes_no', value: null })).toBe(
        false,
      );
      expect(symptomPromptAnswerHasValue({ type: 'yes_no', value: true })).toBe(
        true,
      );
      expect(
        symptomPromptAnswerHasValue({ type: 'yes_no', value: false }),
      ).toBe(true);
    });

    it('severity_scale: false when null, true when set', () => {
      expect(
        symptomPromptAnswerHasValue({ type: 'severity_scale', value: null }),
      ).toBe(false);
      expect(
        symptomPromptAnswerHasValue({ type: 'severity_scale', value: 3 }),
      ).toBe(true);
    });

    it('free_text: false when empty or whitespace-only after trim', () => {
      expect(
        symptomPromptAnswerHasValue({ type: 'free_text', value: '' }),
      ).toBe(false);
      expect(
        symptomPromptAnswerHasValue({ type: 'free_text', value: '   \n\t  ' }),
      ).toBe(false);
      expect(
        symptomPromptAnswerHasValue({ type: 'free_text', value: ' ok ' }),
      ).toBe(true);
    });

    it('photo and video never count as having a value (Week 6 placeholders)', () => {
      expect(symptomPromptAnswerHasValue({ type: 'photo', value: null })).toBe(
        false,
      );
      expect(symptomPromptAnswerHasValue({ type: 'video', value: null })).toBe(
        false,
      );
    });
  });
});
