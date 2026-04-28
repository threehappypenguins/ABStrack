import { describe, expect, it } from 'vitest';
import {
  computeSymptomResumePlacement,
  createDefaultSymptomPromptAnswer,
  createInitialSymptomPromptSession,
  hasSymptomSessionTraversalProgress,
  symptomPromptAnswerHasValue,
} from './symptom-prompt-session.js';
import type { PresetSymptomRow, SymptomResponseType } from './types.js';

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

    it('photo stays empty and video counts when local capture exists', () => {
      expect(symptomPromptAnswerHasValue({ type: 'photo', value: null })).toBe(
        false,
      );
      expect(symptomPromptAnswerHasValue({ type: 'video', value: null })).toBe(
        false,
      );
      expect(
        symptomPromptAnswerHasValue({
          type: 'video',
          value: {
            localUri: 'file:///tmp/capture.mp4',
            durationMs: 7000,
            capturedAt: '2026-04-27T12:00:00.000Z',
          },
        }),
      ).toBe(true);
    });

    it('video is empty when localUri/capturedAt are invalid at runtime', () => {
      expect(
        symptomPromptAnswerHasValue({
          type: 'video',
          value: {
            localUri: '   ',
            durationMs: 7000,
            capturedAt: '2026-04-27T12:00:00.000Z',
          },
        }),
      ).toBe(false);
      expect(
        symptomPromptAnswerHasValue({
          type: 'video',
          value: {
            localUri: 'file:///tmp/capture.mp4',
            durationMs: 7000,
            capturedAt: 'not-a-date',
          },
        }),
      ).toBe(false);
    });
  });

  describe('hasSymptomSessionTraversalProgress', () => {
    it('is false for the initial empty session', () => {
      expect(
        hasSymptomSessionTraversalProgress(createInitialSymptomPromptSession()),
      ).toBe(false);
    });

    it('is true when activeIndex is past the first step', () => {
      expect(
        hasSymptomSessionTraversalProgress({
          activeIndex: 2,
          answers: {},
        }),
      ).toBe(true);
    });

    it('is true when answers map is non-empty even at step zero', () => {
      expect(
        hasSymptomSessionTraversalProgress({
          activeIndex: 0,
          answers: { 'line-1': { type: 'yes_no', value: true } },
        }),
      ).toBe(true);
    });
  });

  describe('computeSymptomResumePlacement', () => {
    const line = (
      id: string,
      sortOrder: number,
      responseType: SymptomResponseType,
    ): PresetSymptomRow => ({
      id,
      preset_id: 'preset-1',
      sort_order: sortOrder,
      symptom_name: 'S',
      response_type: responseType,
      prompt_instruction: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    it('returns the first unanswered line index', () => {
      const a = line('a', 0, 'yes_no');
      const b = line('b', 1, 'yes_no');
      const c = line('c', 2, 'free_text');
      const placement = computeSymptomResumePlacement([a, b, c], {
        [a.id]: { type: 'yes_no', value: true },
        [b.id]: { type: 'yes_no', value: false },
      });
      expect(placement).toEqual({ activeIndex: 2, phase: 'prompting' });
    });

    it('returns complete on the last line when every line is answered', () => {
      const a = line('a', 0, 'yes_no');
      const b = line('b', 1, 'yes_no');
      const placement = computeSymptomResumePlacement([a, b], {
        [a.id]: { type: 'yes_no', value: true },
        [b.id]: { type: 'yes_no', value: false },
      });
      expect(placement).toEqual({ activeIndex: 1, phase: 'complete' });
    });

    it('returns prompting step zero when no answers exist', () => {
      const a = line('a', 0, 'yes_no');
      const placement = computeSymptomResumePlacement([a], {});
      expect(placement).toEqual({ activeIndex: 0, phase: 'prompting' });
    });

    it('returns index 0 and prompting when the preset has no symptom lines', () => {
      expect(computeSymptomResumePlacement([], {})).toEqual({
        activeIndex: 0,
        phase: 'prompting',
      });
      expect(
        computeSymptomResumePlacement([], {
          'orphan-id': { type: 'yes_no', value: true },
        }),
      ).toEqual({ activeIndex: 0, phase: 'prompting' });
    });
  });
});
