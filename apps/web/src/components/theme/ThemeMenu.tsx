'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTheme } from './ThemeProvider';
import { IconCheck, IconComputer, IconMoon, IconSun } from './ThemeIcons';
import type { ThemePreference } from '@/lib/theme-storage';

const OPTIONS: {
  value: ThemePreference;
  label: string;
  description: string;
  Icon: typeof IconSun;
}[] = [
  {
    value: 'system',
    label: 'System',
    description: 'Match device setting (default)',
    Icon: IconComputer,
  },
  {
    value: 'light',
    label: 'Light',
    description: 'Always use light appearance',
    Icon: IconSun,
  },
  {
    value: 'dark',
    label: 'Dark',
    description: 'Always use dark appearance',
    Icon: IconMoon,
  },
];

/**
 * Menu control: theme preference with sun / moon / computer icons, checkmark on selection, and
 * keyboard-friendly disclosure.
 *
 * @returns Theme picker UI.
 */
export function ThemeMenu() {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const TriggerIcon =
    preference === 'light'
      ? IconSun
      : preference === 'dark'
        ? IconMoon
        : IconComputer;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-app-border bg-app-surface text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        title="Theme"
      >
        <TriggerIcon className="h-5 w-5" aria-hidden />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Theme"
          className="absolute right-0 z-[300] mt-2 min-w-[13.5rem] rounded-xl border border-app-border bg-app-surface py-1 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]"
        >
          {OPTIONS.map(({ value, label, description, Icon }) => {
            const selected = preference === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-ring"
                onClick={() => {
                  setPreference(value);
                  setOpen(false);
                }}
              >
                <Icon
                  className="mt-0.5 h-5 w-5 shrink-0 text-app-muted"
                  aria-hidden
                />
                <span className="grow">
                  <span className="block text-sm font-medium text-app-ink">
                    {label}
                  </span>
                  <span className="mt-0.5 block text-xs text-app-muted">
                    {description}
                  </span>
                </span>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center text-app-primary">
                  {selected ? (
                    <IconCheck className="h-4 w-4" aria-hidden />
                  ) : (
                    <span className="h-4 w-4" aria-hidden />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
