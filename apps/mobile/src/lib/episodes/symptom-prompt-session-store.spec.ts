import { createInitialSymptomPromptSession } from '@abstrack/types';
import type { SymptomPromptSessionState } from '@abstrack/types';
import {
  clearSymptomPromptSession,
  getSymptomPromptSession,
  setSymptomPromptSession,
} from './symptom-prompt-session-store';

const initial = createInitialSymptomPromptSession();

/** Episode ids used in this suite — cleared between tests for isolation. */
const EP_1 = 'ep-store-1';
const EP_2 = 'ep-store-2';
const EP_A = 'ep-isolation-a';
const EP_B = 'ep-isolation-b';

describe('symptom-prompt-session-store', () => {
  beforeEach(() => {
    for (const id of [EP_1, EP_2, EP_A, EP_B]) {
      clearSymptomPromptSession(id);
    }
  });

  it('getSymptomPromptSession returns initial state when activeIndex is NaN', () => {
    setSymptomPromptSession(EP_1, {
      activeIndex: NaN,
      answers: {},
    });
    expect(getSymptomPromptSession(EP_1)).toEqual(initial);
  });

  it('getSymptomPromptSession returns initial state when activeIndex is Infinity', () => {
    setSymptomPromptSession(EP_1, {
      activeIndex: Number.POSITIVE_INFINITY,
      answers: {},
    });
    expect(getSymptomPromptSession(EP_1)).toEqual(initial);
  });

  it('getSymptomPromptSession floors and clamps non-negative activeIndex', () => {
    setSymptomPromptSession(EP_1, {
      activeIndex: 2.7,
      answers: { 'line-a': { type: 'yes_no', value: true } },
    });
    expect(getSymptomPromptSession(EP_1)).toEqual({
      activeIndex: 2,
      answers: { 'line-a': { type: 'yes_no', value: true } },
    });
  });

  it('getSymptomPromptSession clamps negative activeIndex to 0', () => {
    setSymptomPromptSession(EP_1, {
      activeIndex: -3,
      answers: {},
    });
    expect(getSymptomPromptSession(EP_1).activeIndex).toBe(0);
  });

  it('getSymptomPromptSession rejects answers array', () => {
    setSymptomPromptSession(EP_1, {
      activeIndex: 0,
      answers: [] as unknown as SymptomPromptSessionState['answers'],
    });
    expect(getSymptomPromptSession(EP_1)).toEqual(initial);
  });

  it('getSymptomPromptSession rejects null answers', () => {
    setSymptomPromptSession(EP_1, {
      activeIndex: 0,
      answers: null as unknown as SymptomPromptSessionState['answers'],
    });
    expect(getSymptomPromptSession(EP_1)).toEqual(initial);
  });

  it('getSymptomPromptSession drops malformed answer entries but keeps valid ones and activeIndex', () => {
    setSymptomPromptSession(EP_1, {
      activeIndex: 1,
      answers: {
        good: { type: 'yes_no', value: true },
        badNull: null,
        badString: 'x',
        badType: { type: 'unknown', value: null },
        badYesNo: { type: 'yes_no', value: 'yes' },
        badScale: { type: 'severity_scale', value: '3' },
        badSeverityOor: { type: 'severity_scale', value: 99 },
        badSeverityFloat: { type: 'severity_scale', value: 3.5 },
        badFreeText: { type: 'free_text', value: 12 },
        badPhoto: { type: 'photo', value: 'x' },
      } as unknown as SymptomPromptSessionState['answers'],
    });
    expect(getSymptomPromptSession(EP_1)).toEqual({
      activeIndex: 1,
      answers: {
        good: { type: 'yes_no', value: true },
        badSeverityOor: { type: 'severity_scale', value: null },
        badSeverityFloat: { type: 'severity_scale', value: null },
      },
    });
  });

  it('getSymptomPromptSession keeps severity_scale only for integers 1–5 or null', () => {
    setSymptomPromptSession(EP_1, {
      activeIndex: 0,
      answers: {
        a: { type: 'severity_scale', value: 1 },
        b: { type: 'severity_scale', value: 5 },
        c: { type: 'severity_scale', value: null },
      },
    });
    expect(getSymptomPromptSession(EP_1)).toEqual({
      activeIndex: 0,
      answers: {
        a: { type: 'severity_scale', value: 1 },
        b: { type: 'severity_scale', value: 5 },
        c: { type: 'severity_scale', value: null },
      },
    });
  });

  it('getSymptomPromptSession returns empty answers when all entries are invalid', () => {
    setSymptomPromptSession(EP_1, {
      activeIndex: 2,
      answers: {
        x: { type: 'yes_no', value: [] },
      } as unknown as SymptomPromptSessionState['answers'],
    });
    expect(getSymptomPromptSession(EP_1)).toEqual({
      activeIndex: 2,
      answers: {},
    });
  });

  it('keeps state isolated per episode id', () => {
    setSymptomPromptSession(EP_A, {
      activeIndex: 1,
      answers: { x: { type: 'free_text', value: 'a' } },
    });
    setSymptomPromptSession(EP_B, {
      activeIndex: 2,
      answers: { y: { type: 'free_text', value: 'b' } },
    });
    expect(getSymptomPromptSession(EP_A)).toEqual({
      activeIndex: 1,
      answers: { x: { type: 'free_text', value: 'a' } },
    });
    expect(getSymptomPromptSession(EP_B)).toEqual({
      activeIndex: 2,
      answers: { y: { type: 'free_text', value: 'b' } },
    });
  });

  it('clearSymptomPromptSession removes only that episode', () => {
    setSymptomPromptSession(EP_1, { activeIndex: 0, answers: {} });
    setSymptomPromptSession(EP_2, {
      activeIndex: 1,
      answers: { z: { type: 'yes_no', value: false } },
    });
    clearSymptomPromptSession(EP_1);
    expect(getSymptomPromptSession(EP_1)).toEqual(initial);
    expect(getSymptomPromptSession(EP_2)).toEqual({
      activeIndex: 1,
      answers: { z: { type: 'yes_no', value: false } },
    });
  });
});
