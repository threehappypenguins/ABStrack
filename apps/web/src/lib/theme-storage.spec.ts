import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  readStoredTheme,
  writeStoredTheme,
} from './theme-storage';

describe('theme-storage', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    window.matchMedia = originalMatchMedia;
  });

  it('readStoredTheme returns system when unset', () => {
    expect(readStoredTheme()).toBe('system');
  });

  it('readStoredTheme returns system when localStorage.getItem throws', () => {
    const spy = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new DOMException('Access denied');
      });
    expect(readStoredTheme()).toBe('system');
    spy.mockRestore();
  });

  it.each([[''], ['not-a-theme'], ['LIGHT'], ['system']])(
    'readStoredTheme returns system when storage is invalid (%s)',
    (stored) => {
      localStorage.setItem(THEME_STORAGE_KEY, stored);
      expect(readStoredTheme()).toBe('system');
    },
  );

  it('writeStoredTheme persists light and dark', () => {
    writeStoredTheme('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    writeStoredTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('writeStoredTheme removes key for system', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    writeStoredTheme('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('writeStoredTheme does not throw when localStorage.setItem throws', () => {
    const spy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Access denied');
      });
    expect(() => writeStoredTheme('dark')).not.toThrow();
    spy.mockRestore();
  });

  it('applyThemeToDocument toggles dark class', () => {
    applyThemeToDocument('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    applyThemeToDocument('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applyThemeToDocument(system) adds dark when prefers-color-scheme dark', () => {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));

    applyThemeToDocument('system');

    expect(window.matchMedia).toHaveBeenCalledWith(
      '(prefers-color-scheme: dark)',
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applyThemeToDocument(system) removes dark when prefers-color-scheme light', () => {
    document.documentElement.classList.add('dark');
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));

    applyThemeToDocument('system');

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
