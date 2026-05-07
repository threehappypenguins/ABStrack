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
    mockAnnounce.mockReset();
  });

  it('calls AccessibilityInfo.announceForAccessibility with trimmed text', () => {
    announce('  Profile saved  ');
    expect(mockAnnounce).toHaveBeenCalledWith('Profile saved');
  });

  it('does not announce whitespace-only messages', () => {
    announce('   ');
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it('swallows a rejected promise from announceForAccessibility (no LogBox unhandled rejection)', async () => {
    mockAnnounce.mockReturnValue(
      Promise.reject(new Error('RN accessibility busy')),
    );
    expect(() => announce('Saved')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('ignores a synchronous throw from announceForAccessibility', () => {
    mockAnnounce.mockImplementation(() => {
      throw new TypeError('announceForAccessibility is not a function');
    });
    expect(() => announce('Hello')).not.toThrow();
    expect(mockAnnounce).toHaveBeenCalledWith('Hello');
  });
});
