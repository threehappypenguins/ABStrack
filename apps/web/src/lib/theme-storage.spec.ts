import {
  THEME_STORAGE_KEY,
  applyThemeToDocument,
  readStoredTheme,
  writeStoredTheme,
} from './theme-storage';

describe('theme-storage', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('readStoredTheme returns system when unset', () => {
    expect(readStoredTheme()).toBe('system');
  });

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

  it('applyThemeToDocument toggles dark class', () => {
    applyThemeToDocument('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    applyThemeToDocument('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
