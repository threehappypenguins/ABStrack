import { describe, expect, it } from 'vitest';
import {
  EPISODE_TEMPLATE_NAME_MAX_LENGTH,
  normalizeEpisodeTemplateName,
  validateEpisodeTemplateName,
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
