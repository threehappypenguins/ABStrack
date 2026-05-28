'use client';

import { useAnnounce } from '@abstrack/ui/a11y-web';
import type { ReactNode } from 'react';
import { useCallback } from 'react';

const PLAY_STORE_BADGE_SRC =
  'https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png';
const APP_STORE_BADGE_SRC =
  'https://toolbox.marketingtools.apple.com/api/badges/download-on-the-app-store/black/en-us?size=250x83';

/** Fixed frame so Play and App Store art align with identical padding and visual weight. */
const STORE_BADGE_FRAME_CLASS =
  'flex h-14 w-[180px] shrink-0 items-center justify-center sm:h-16 sm:w-[200px]';

/**
 * MVP placeholder store badges on the landing page (announce-only until stores ship).
 *
 * @returns Store badge controls for the hero column.
 */
export function LandingStoreBadges() {
  const { announce } = useAnnounce();

  const onMvpPlaceholder = useCallback(
    (label: string) => {
      announce(`${label} will be available after ABStrack reaches MVP.`, {
        politeness: 'polite',
      });
    },
    [announce],
  );

  return (
    <div className="mt-10 flex flex-col items-center gap-4 lg:mt-0">
      <p className="text-sm font-medium text-app-ink">
        Get the app (Coming soon)
      </p>
      <div className="flex flex-wrap items-center justify-center gap-4">
        <MvpStoreBadge
          label="Google Play"
          onActivate={() => onMvpPlaceholder('Google Play download')}
        >
          <span className={STORE_BADGE_FRAME_CLASS}>
            <img
              src={PLAY_STORE_BADGE_SRC}
              alt=""
              width={180}
              height={70}
              className="max-h-full max-w-full object-contain object-center opacity-90"
              decoding="async"
            />
          </span>
        </MvpStoreBadge>
        <MvpStoreBadge
          label="App Store"
          onActivate={() => onMvpPlaceholder('App Store download')}
        >
          <span className={STORE_BADGE_FRAME_CLASS}>
            <img
              src={APP_STORE_BADGE_SRC}
              alt=""
              width={160}
              height={54}
              className="max-h-full max-w-full object-contain object-center opacity-90"
              decoding="async"
            />
          </span>
        </MvpStoreBadge>
      </div>
    </div>
  );
}

function MvpStoreBadge({
  label,
  onActivate,
  children,
}: {
  label: string;
  onActivate: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center rounded-lg border border-dashed border-app-border bg-app-bg/50 p-3 transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
      aria-label={`${label} — not yet available`}
      onClick={onActivate}
    >
      {children}
    </button>
  );
}
