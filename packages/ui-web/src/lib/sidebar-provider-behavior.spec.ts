import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readSidebarOpenCookie,
  shouldToggleSidebarFromKeyboard,
  writeSidebarOpenCookie,
} from './sidebar-provider-behavior.js';

const COOKIE = 'abstrack_test_sidebar_state';

function clearCookie(name: string): void {
  document.cookie = `${name}=; path=/; max-age=0`;
}

function dispatchKey(
  init: KeyboardEventInit & { target?: EventTarget | null },
): KeyboardEvent {
  const { target = document.body, ...rest } = init;
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...rest,
  });
  Object.defineProperty(event, 'target', {
    configurable: true,
    value: target,
  });
  return event;
}

describe('readSidebarOpenCookie', () => {
  afterEach(() => {
    clearCookie(COOKIE);
  });

  it('returns null when the cookie is absent', () => {
    expect(readSidebarOpenCookie(COOKIE)).toBeNull();
  });

  it('parses true and false from document.cookie', () => {
    document.cookie = `${COOKIE}=true; path=/`;
    expect(readSidebarOpenCookie(COOKIE)).toBe(true);

    document.cookie = `${COOKIE}=false; path=/`;
    expect(readSidebarOpenCookie(COOKIE)).toBe(false);
  });

  it('returns null for invalid values', () => {
    document.cookie = `${COOKIE}=maybe; path=/`;
    expect(readSidebarOpenCookie(COOKIE)).toBeNull();
  });
});

describe('writeSidebarOpenCookie', () => {
  afterEach(() => {
    clearCookie(COOKIE);
  });

  it('persists open state readable by readSidebarOpenCookie', () => {
    writeSidebarOpenCookie(COOKIE, false);
    expect(readSidebarOpenCookie(COOKIE)).toBe(false);

    writeSidebarOpenCookie(COOKIE, true);
    expect(readSidebarOpenCookie(COOKIE)).toBe(true);
  });
});

describe('shouldToggleSidebarFromKeyboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts Ctrl+B on non-mac platforms', () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Windows',
    });
    const event = dispatchKey({ key: 'b', ctrlKey: true });
    expect(shouldToggleSidebarFromKeyboard(event)).toBe(true);
  });

  it('accepts Meta+B on mac-like platforms', () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    });
    const event = dispatchKey({ key: 'B', metaKey: true });
    expect(shouldToggleSidebarFromKeyboard(event)).toBe(true);
  });

  it('ignores Ctrl+B on mac-like platforms', () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    });
    const event = dispatchKey({ key: 'b', ctrlKey: true });
    expect(shouldToggleSidebarFromKeyboard(event)).toBe(false);
  });

  it('ignores the shortcut without a modifier', () => {
    const event = dispatchKey({ key: 'b' });
    expect(shouldToggleSidebarFromKeyboard(event)).toBe(false);
  });

  it('ignores repeated keydown while the shortcut is held', () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Windows',
    });
    const event = dispatchKey({ key: 'b', ctrlKey: true, repeat: true });
    expect(shouldToggleSidebarFromKeyboard(event)).toBe(false);
  });

  it('ignores the shortcut when focus is in a text input', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const event = dispatchKey({ key: 'b', ctrlKey: true, target: input });
    expect(shouldToggleSidebarFromKeyboard(event)).toBe(false);
    input.remove();
  });

  it('allows the shortcut when focus is on a button input', () => {
    const input = document.createElement('input');
    input.type = 'button';
    document.body.append(input);
    const event = dispatchKey({ key: 'b', ctrlKey: true, target: input });
    expect(shouldToggleSidebarFromKeyboard(event)).toBe(true);
    input.remove();
  });
});
