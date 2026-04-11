import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAnnounce } = vi.hoisted(() => ({
  mockAnnounce: vi.fn(),
}));

vi.mock('react-native', () => ({
  AccessibilityInfo: {
    announceForAccessibility: mockAnnounce,
  },
}));

import { announce } from './announceNative.js';

describe('announce (native)', () => {
  beforeEach(() => {
    mockAnnounce.mockClear();
  });

  it('calls AccessibilityInfo.announceForAccessibility with trimmed text', () => {
    announce('  Profile saved  ');
    expect(mockAnnounce).toHaveBeenCalledWith('Profile saved');
  });

  it('does not announce whitespace-only messages', () => {
    announce('   ');
    expect(mockAnnounce).not.toHaveBeenCalled();
  });
});
