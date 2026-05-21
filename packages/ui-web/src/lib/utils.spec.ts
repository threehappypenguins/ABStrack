import { describe, expect, it } from 'vitest';

import { cn } from './utils.js';

describe('cn', () => {
  it('merges tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });
});
