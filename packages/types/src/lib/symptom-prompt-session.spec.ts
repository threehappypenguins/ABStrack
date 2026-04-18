import { describe, expect, it } from 'vitest';
import { createInitialSymptomPromptSession } from './symptom-prompt-session.js';

describe('symptom-prompt-session', () => {
  it('createInitialSymptomPromptSession starts at first step with no answers', () => {
    const s = createInitialSymptomPromptSession();
    expect(s.activeIndex).toBe(0);
    expect(s.answers).toEqual({});
  });
});
