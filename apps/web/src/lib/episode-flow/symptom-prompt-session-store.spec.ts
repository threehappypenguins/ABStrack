import { createInitialSymptomPromptSession } from '@abstrack/types';
import {
  clearSymptomPromptSession,
  getSymptomPromptSession,
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

  it('clearSymptomPromptSession removes key', () => {
    setStored('ep-1', { activeIndex: 0, answers: {} });
    clearSymptomPromptSession('ep-1');
    expect(getSymptomPromptSession('ep-1')).toEqual(initial);
  });
});
