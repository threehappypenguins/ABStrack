import { createInitialSymptomPromptSession } from '@abstrack/types';
import {
  clearSymptomPromptSession,
  getSymptomPromptSession,
  setSymptomPromptSession,
} from './symptom-prompt-session-store';

const initial = createInitialSymptomPromptSession();

function setStored(episodeId: string, value: unknown): void {
  sessionStorage.setItem(
    `abstrack.symptomPrompt.${episodeId}`,
    JSON.stringify(value),
  );
}

/** Writes a raw string (bypasses JSON.stringify) to exercise parse edge cases. */
function setStoredRaw(episodeId: string, raw: string): void {
  sessionStorage.setItem(`abstrack.symptomPrompt.${episodeId}`, raw);
}

describe('symptom-prompt-session-store', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('getSymptomPromptSession returns initial state when activeIndex is null (JSON.stringify maps NaN/Infinity to null)', () => {
    expect(JSON.stringify({ activeIndex: NaN, answers: {} })).toBe(
      '{"activeIndex":null,"answers":{}}',
    );
    setStored('ep-1', { activeIndex: null, answers: {} });
    expect(getSymptomPromptSession('ep-1')).toEqual(initial);
  });

  it('getSymptomPromptSession returns initial state when activeIndex is Infinity (JSON number literal in stored payload)', () => {
    setStoredRaw('ep-1', '{"activeIndex":1e400,"answers":{}}');
    expect(getSymptomPromptSession('ep-1')).toEqual(initial);
  });

  it('getSymptomPromptSession returns initial state when activeIndex is not a number (e.g. string)', () => {
    setStoredRaw('ep-1', '{"activeIndex":"2","answers":{}}');
    expect(getSymptomPromptSession('ep-1')).toEqual(initial);
  });

  it('getSymptomPromptSession returns initial state when stored JSON is invalid', () => {
    setStoredRaw('ep-1', '{"activeIndex":');
    expect(getSymptomPromptSession('ep-1')).toEqual(initial);
  });

  it('getSymptomPromptSession floors and clamps non-negative index', () => {
    setStored('ep-1', {
      activeIndex: 2.7,
      answers: { a: { type: 'yes_no', value: true } },
    });
    expect(getSymptomPromptSession('ep-1')).toEqual({
      activeIndex: 2,
      answers: { a: { type: 'yes_no', value: true } },
    });
  });

  it('getSymptomPromptSession clamps negative index to 0', () => {
    setStored('ep-1', { activeIndex: -3, answers: {} });
    expect(getSymptomPromptSession('ep-1').activeIndex).toBe(0);
  });

  it('getSymptomPromptSession rejects answers array', () => {
    setStored('ep-1', { activeIndex: 0, answers: [] });
    expect(getSymptomPromptSession('ep-1')).toEqual(initial);
  });

  it('getSymptomPromptSession drops corrupted answer entries but keeps valid ones and activeIndex', () => {
    setStored('ep-1', {
      activeIndex: 1,
      answers: {
        good: { type: 'yes_no', value: true },
        badString: 'not-an-object',
        badNull: null,
        badType: { type: 'unknown', value: null },
        badYesNo: { type: 'yes_no', value: 'yes' },
        badScale: { type: 'severity_scale', value: '3' },
        badSeverityOor: { type: 'severity_scale', value: 99 },
        badSeverityFloat: { type: 'severity_scale', value: 3.5 },
        badFreeText: { type: 'free_text', value: 12 },
        badPhoto: { type: 'photo', value: 'x' },
      },
    });
    expect(getSymptomPromptSession('ep-1')).toEqual({
      activeIndex: 1,
      answers: {
        good: { type: 'yes_no', value: true },
        badSeverityOor: { type: 'severity_scale', value: null },
        badSeverityFloat: { type: 'severity_scale', value: null },
      },
    });
  });

  it('getSymptomPromptSession does not copy prototype-polluting answer keys', () => {
    const answers = JSON.parse(
      '{"__proto__":{"type":"yes_no","value":true},"constructor":{"type":"yes_no","value":false},"prototype":{"type":"yes_no","value":true},"legit":{"type":"yes_no","value":false}}',
    ) as Record<string, unknown>;
    setStored('ep-1', { activeIndex: 0, answers });
    expect(getSymptomPromptSession('ep-1')).toEqual({
      activeIndex: 0,
      answers: { legit: { type: 'yes_no', value: false } },
    });
  });

  it('getSymptomPromptSession keeps severity_scale only for integers 1–5 or null', () => {
    setStored('ep-1', {
      activeIndex: 0,
      answers: {
        a: { type: 'severity_scale', value: 1 },
        b: { type: 'severity_scale', value: 5 },
        c: { type: 'severity_scale', value: null },
      },
    });
    expect(getSymptomPromptSession('ep-1')).toEqual({
      activeIndex: 0,
      answers: {
        a: { type: 'severity_scale', value: 1 },
        b: { type: 'severity_scale', value: 5 },
        c: { type: 'severity_scale', value: null },
      },
    });
  });

  it('getSymptomPromptSession returns empty answers when all entries are invalid', () => {
    setStored('ep-1', {
      activeIndex: 2,
      answers: { x: { type: 'yes_no', value: [] } },
    });
    expect(getSymptomPromptSession('ep-1')).toEqual({
      activeIndex: 2,
      answers: {},
    });
  });

  it('clearSymptomPromptSession removes key', () => {
    setStored('ep-1', { activeIndex: 0, answers: {} });
    clearSymptomPromptSession('ep-1');
    expect(getSymptomPromptSession('ep-1')).toEqual(initial);
  });

  it('setSymptomPromptSession keeps video answers in runtime while omitting them from storage', () => {
    setSymptomPromptSession('ep-1', {
      activeIndex: 1,
      answers: {
        keep: { type: 'yes_no', value: true },
        drop: {
          type: 'video',
          value: {
            localUri: 'blob:https://example.test/abc',
            durationMs: 5000,
            capturedAt: '2026-04-27T12:00:00.000Z',
          },
        },
      },
    });
    expect(
      JSON.parse(sessionStorage.getItem('abstrack.symptomPrompt.ep-1') ?? '{}'),
    ).toEqual({
      activeIndex: 1,
      answers: {
        keep: { type: 'yes_no', value: true },
      },
    });
    expect(getSymptomPromptSession('ep-1')).toEqual({
      activeIndex: 1,
      answers: {
        keep: { type: 'yes_no', value: true },
        drop: {
          type: 'video',
          value: {
            localUri: 'blob:https://example.test/abc',
            durationMs: 5000,
            capturedAt: '2026-04-27T12:00:00.000Z',
          },
        },
      },
    });
  });

  it('clearSymptomPromptSession clears runtime-only video answers', () => {
    setSymptomPromptSession('ep-1', {
      activeIndex: 0,
      answers: {
        drop: {
          type: 'video',
          value: {
            localUri: 'blob:https://example.test/abc',
            durationMs: 5000,
            capturedAt: '2026-04-27T12:00:00.000Z',
          },
        },
      },
    });
    clearSymptomPromptSession('ep-1');
    expect(getSymptomPromptSession('ep-1')).toEqual(initial);
  });
});
