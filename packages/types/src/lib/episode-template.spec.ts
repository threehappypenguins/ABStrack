import { describe, expect, it } from 'vitest';
import {
  EPISODE_TEMPLATE_NAME_MAX_LENGTH,
  normalizeEpisodeTemplateName,
  validateEpisodeTemplateName,
  validateEpisodeTemplatePresetPair,
} from './episode-template.js';

describe('episode template name helpers', () => {
  it('normalizes whitespace', () => {
    expect(normalizeEpisodeTemplateName('  ABS Episode  ')).toBe('ABS Episode');
  });

  it('rejects empty names', () => {
    const r = validateEpisodeTemplateName('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('Enter a name');
    }
  });

  it('accepts valid names', () => {
    const r = validateEpisodeTemplateName('ABS Episode');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.name).toBe('ABS Episode');
    }
  });

  it('rejects names over max length', () => {
    const long = 'x'.repeat(EPISODE_TEMPLATE_NAME_MAX_LENGTH + 1);
    const r = validateEpisodeTemplateName(long);
    expect(r.ok).toBe(false);
  });
});

describe('validateEpisodeTemplatePresetPair', () => {
  const symptomId = '11111111-1111-1111-1111-111111111111';
  const markerId = '22222222-2222-2222-2222-222222222222';

  it('rejects missing symptom preset id (null / undefined / empty)', () => {
    for (const symptom of [null, undefined, '', '   '] as const) {
      const r = validateEpisodeTemplatePresetPair(symptom, markerId);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toBe('Choose a symptom preset.');
      }
    }
  });

  it('rejects missing health marker preset id when symptom is set', () => {
    for (const marker of [null, undefined, '', '   '] as const) {
      const r = validateEpisodeTemplatePresetPair(symptomId, marker);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toBe('Choose a health marker preset.');
      }
    }
  });

  it('accepts when both ids are non-empty (trims whitespace)', () => {
    const r = validateEpisodeTemplatePresetPair(
      `  ${symptomId}  `,
      `  ${markerId}  `,
    );
    expect(r.ok).toBe(true);
  });

  it('accepts minimal non-whitespace ids', () => {
    expect(validateEpisodeTemplatePresetPair('a', 'b').ok).toBe(true);
  });
});
