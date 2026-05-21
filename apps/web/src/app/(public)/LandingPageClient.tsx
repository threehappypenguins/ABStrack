'use client';

import { useAnnounce } from '@abstrack/ui/a11y-web';
import { Inter } from 'next/font/google';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCallback, useEffect } from 'react';
import { useAuth } from '../../lib/auth-provider';
import { LandingDashboardCharts } from './components/LandingDashboardCharts';

const fontWordmark = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

const PLAY_STORE_BADGE_SRC =
  'https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png';
const APP_STORE_BADGE_SRC =
  'https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83';

/** Fixed frame so Play and App Store art align with identical padding and visual weight. */
const STORE_BADGE_FRAME_CLASS =
  'flex h-14 w-[180px] shrink-0 items-center justify-center sm:h-16 sm:w-[200px]';

/**
 * Public marketing landing for `/`: ABS context, advocacy link, illustrative charts,
 * and MVP-disabled sign-in / store controls. Authenticated users are sent to the dashboard.
 *
 * @returns Landing or loading UI.
 */
export function LandingPageClient() {
  const { session, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && session) {
      router.replace('/dashboard');
    }
  }, [loading, session, router]);

  const { announce } = useAnnounce();

  const onMvpPlaceholder = useCallback(
    (label: string) => {
      announce(`${label} will be available after ABStrack reaches MVP.`, {
        politeness: 'polite',
      });
    },
    [announce],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent px-4">
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-app-primary border-t-transparent"
            aria-hidden
          />
          <p className="text-sm font-medium text-app-muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent px-4">
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-app-primary border-t-transparent"
            aria-hidden
          />
          <p className="text-sm font-medium text-app-muted">
            Redirecting to your dashboard…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="mx-auto max-w-6xl space-y-16 px-4 py-12 sm:px-6 lg:space-y-20 lg:px-8 lg:py-16">
        <section className="text-center lg:text-left lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-app-ink sm:text-4xl">
              Health tracking built for{' '}
              <span className="text-app-primary">Auto-Brewery Syndrome</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-app-muted lg:mx-0">
              ABStrack is an open-source, privacy-first app for people living
              with ABS — a rare condition where ethanol is produced in the body,
              causing intoxication-like symptoms without drinking. Presentations
              vary widely; many patients remain underdiagnosed. We focus on
              fast, accessible logging during episodes, ABS-relevant markers
              (such as BAC and glucose), optional media for symptoms, and clear
              sharing with clinicians you authorize.
            </p>
          </div>
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
        </section>

        <section className="rounded-2xl border border-app-border/90 bg-app-surface/60 p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8">
          <h2 className="text-xl font-semibold text-app-ink">
            Why ABStrack exists
          </h2>
          <ul className="mt-4 list-inside list-disc space-y-2 text-sm leading-relaxed text-app-muted marker:text-app-primary">
            <li>
              <strong className="font-medium text-app-ink">
                Impaired-use design.
              </strong>{' '}
              During an episode you may be cognitively impaired; flows aim for
              large targets, minimal choices, and linear steps — not generic
              symptom-app complexity.
            </li>
            <li>
              <strong className="font-medium text-app-ink">
                ABS-specific markers.
              </strong>{' '}
              BAC, glucose, blood pressure, and other readings that matter for
              your care team, with presets you define when you are well.
            </li>
            <li>
              <strong className="font-medium text-app-ink">
                Privacy-first.
              </strong>{' '}
              Consumer-directed health data: you control access; practitioners
              see data only after explicit, auditable authorization.
            </li>
            <li>
              <strong className="font-medium text-app-ink">
                Patterns over time.
              </strong>{' '}
              Charts and summaries (similar to the sample below) help you and
              authorized clinicians spot trends for diagnosis and treatment
              planning.
            </li>
          </ul>
        </section>

        <section aria-labelledby="landing-demo-heading">
          <h2
            id="landing-demo-heading"
            className="text-center text-xl font-semibold text-app-ink"
          >
            Sample reporting
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-app-muted">
            After you log episodes and markers, ABStrack can surface summaries
            like weekly episode counts, marker trends, and symptom frequency —
            always under your control. The dashboard below uses{' '}
            <strong className="font-medium text-app-ink">
              illustrative data only
            </strong>
            .
          </p>
          <div className="mt-8">
            <LandingDashboardCharts />
          </div>
        </section>

        <section className="rounded-2xl border border-app-border/90 bg-app-surface/60 p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-app-ink">
            Advocacy and education
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-app-muted">
            For patient advocacy, provider education, legal resources, and
            research into auto-brewery syndrome, visit{' '}
            <a
              href="https://www.autobrewery.org/"
              className="font-medium text-app-primary underline decoration-app-primary/40 underline-offset-2 hover:decoration-app-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Auto Brewery Syndrome Advocacy and Research
            </a>{' '}
            (autobrewery.org) — an independent non-profit site.
          </p>
        </section>

        <footer className="border-t border-app-border/60 pt-8 text-center text-xs text-app-muted">
          <p className="text-center">
            <span className="inline-flex flex-wrap items-center justify-center gap-x-1 gap-y-0">
              <span>&copy; 2026</span>
              <BrandWordmarkText />
              <span>.</span>
            </span>
          </p>
        </footer>
      </div>
    </div>
  );
}

/**
 * Inter wordmark: medium “ABS”, regular “track”, for brand lockups.
 *
 * @param props - Props.
 * @param props.className - Optional extra Tailwind classes (e.g. size, color).
 * @returns Span with styled product name.
 */
function BrandWordmarkText({ className = '' }: { className?: string }) {
  return (
    <span className={`${fontWordmark.className} ${className}`.trim()}>
      <span className="font-medium">ABS</span>
      <span className="font-normal">track</span>
    </span>
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
