import { THEME_STORAGE_KEY } from './theme-storage';

/**
 * Inline bootstrap for `html.dark` before React hydrates (avoids theme flash). Uses
 * {@link THEME_STORAGE_KEY} so the key matches {@link readStoredTheme} / {@link applyThemeToDocument}.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var t=localStorage.getItem(k);var d=document.documentElement;if(t==='dark')d.classList.add('dark');else if(t==='light')d.classList.remove('dark');else{if(window.matchMedia('(prefers-color-scheme: dark)').matches)d.classList.add('dark');else d.classList.remove('dark');}}catch(e){}})();`;
