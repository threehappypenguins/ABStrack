'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from './ThemeProvider';
import { IconCheck, IconComputer, IconMoon, IconSun } from './ThemeIcons';
import type { ThemePreference } from '@/lib/theme-storage';

/** Above app chrome, charts, and Recharts tooltip layers. */
const THEME_MENU_POPOVER_Z_INDEX = 5000;

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
 * Positions the theme radiogroup popover under the trigger using viewport coordinates.
 *
 * @param trigger - Theme menu disclosure button.
 * @returns Fixed-position style for the portaled popover.
 */
function getThemeMenuPanelStyle(trigger: HTMLButtonElement): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  return {
    position: 'fixed',
    top: rect.bottom + 8,
    right: Math.max(8, window.innerWidth - rect.right),
    zIndex: THEME_MENU_POPOVER_Z_INDEX,
  };
}

/**
 * Theme preference control: disclosure button plus a popup implemented as a **radiogroup**
 * (mutually exclusive options) with arrow / Home / End keyboard navigation per the WAI-ARIA
 * Radio Group pattern—not a full application menu. The popover is portaled to `document.body`
 * so it is not clipped or covered by sticky header stacking contexts or page content.
 * Closing the popup restores focus to the trigger so focus is not lost when the radios unmount.
 *
 * @returns Theme picker UI.
 */
export function ThemeMenu() {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({
    visibility: 'hidden',
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wasOpenRef = useRef(false);
  const groupId = useId();

  const TriggerIcon =
    preference === 'light'
      ? IconSun
      : preference === 'dark'
        ? IconMoon
        : IconComputer;

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) {
        return;
      }
      setPanelStyle({
        ...getThemeMenuPanelStyle(trigger),
        visibility: 'visible',
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const selectedIndex = Math.max(
      0,
      OPTIONS.findIndex((o) => o.value === preference),
    );
    const id = requestAnimationFrame(() => {
      itemRefs.current[selectedIndex]?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, preference]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
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

  const handleRadiogroupKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = OPTIONS.findIndex((o) => o.value === preference);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const { key } = e;

    if (key === 'ArrowDown' || key === 'ArrowRight') {
      e.preventDefault();
      const next = (safeIndex + 1) % OPTIONS.length;
      setPreference(OPTIONS[next].value);
      requestAnimationFrame(() => itemRefs.current[next]?.focus());
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (safeIndex - 1 + OPTIONS.length) % OPTIONS.length;
      setPreference(OPTIONS[prev].value);
      requestAnimationFrame(() => itemRefs.current[prev]?.focus());
      return;
    }
    if (key === 'Home') {
      e.preventDefault();
      setPreference(OPTIONS[0].value);
      requestAnimationFrame(() => itemRefs.current[0]?.focus());
      return;
    }
    if (key === 'End') {
      e.preventDefault();
      const last = OPTIONS.length - 1;
      setPreference(OPTIONS[last].value);
      requestAnimationFrame(() => itemRefs.current[last]?.focus());
    }
  };

  const panel = open ? (
    <div
      ref={panelRef}
      id={groupId}
      role="radiogroup"
      aria-label="Theme"
      style={panelStyle}
      className="min-w-[13.5rem] rounded-xl border border-app-border bg-app-surface py-1 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]"
      onKeyDown={handleRadiogroupKeyDown}
    >
      {OPTIONS.map(({ value, label, description, Icon }, index) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
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
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-app-border bg-app-surface text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        aria-label="Theme"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? groupId : undefined}
        onClick={() => setOpen((o) => !o)}
        title="Theme"
      >
        <TriggerIcon className="h-5 w-5" aria-hidden />
      </button>

      {typeof document !== 'undefined' && panel
        ? createPortal(panel, document.body)
        : null}
    </>
  );
}
