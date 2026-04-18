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

describe('symptom-prompt-session-store', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('getSymptomPromptSession returns initial state when activeIndex is NaN', () => {
    setStored('ep-1', { activeIndex: NaN, answers: {} });
    expect(getSymptomPromptSession('ep-1')).toEqual(initial);
  });

  it('getSymptomPromptSession returns initial state when activeIndex is Infinity', () => {
    setStored('ep-1', { activeIndex: Number.POSITIVE_INFINITY, answers: {} });
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
