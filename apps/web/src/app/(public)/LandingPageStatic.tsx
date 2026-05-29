import { Inter } from 'next/font/google';
import { GITHUB_REPOSITORY_URL } from '@/lib/site-seo';
import { LandingDashboardCharts } from './components/LandingDashboardCharts';
import { LandingGitHubLink } from './LandingGitHubLink';
import { LandingStoreBadges } from './LandingStoreBadges';

const fontWordmark = Inter({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

/**
 * Server-rendered marketing copy for `/` (crawlable without waiting on client JS).
 *
 * @returns Static landing sections; interactive store badges and charts are client islands.
 */
export function LandingPageStatic() {
  return (
    <div className="min-h-full flex-1 bg-transparent">
      <div className="mx-auto max-w-6xl space-y-16 px-4 py-12 sm:px-6 lg:space-y-20 lg:px-8 lg:py-16">
        <section className="text-center lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-12 lg:text-left">
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
            <LandingGitHubLink />
          </div>
          <LandingStoreBadges />
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
              <span className={fontWordmark.className}>
                <span className="font-medium">ABS</span>
                <span className="font-normal">track</span>
              </span>
              <span>.</span>
            </span>
          </p>
          <p className="mt-2">
            <a
              href={GITHUB_REPOSITORY_URL}
              className="font-medium text-app-primary underline decoration-app-primary/40 underline-offset-2 hover:decoration-app-primary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open source on GitHub
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
