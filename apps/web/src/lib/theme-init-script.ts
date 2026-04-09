/**
 * Inline bootstrap for `html.dark` before React hydrates (avoids theme flash). Must stay in sync
 * with {@link readStoredTheme} / {@link applyThemeToDocument}.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  'abstrack-theme',
)};var t=localStorage.getItem(k);var d=document.documentElement;if(t==='dark')d.classList.add('dark');else if(t==='light')d.classList.remove('dark');else{if(window.matchMedia('(prefers-color-scheme: dark)').matches)d.classList.add('dark');else d.classList.remove('dark');}}catch(e){}})();`;
