import Link from 'next/link';
import { EpisodeStartFlow } from '@/components/episode-flow/EpisodeStartFlow';

/**
 * Episode-start flow: template picker and episode row creation after the home CTA.
 *
 * @returns Authenticated episode start page.
 */
export default function EpisodeStartPage() {
  return (
    <div className="w-full space-y-8">
      <div>
        <p className="text-sm font-medium text-app-muted">
          <Link
            href="/dashboard"
            className="rounded-md text-app-primary underline decoration-app-primary/40 underline-offset-2 outline-none transition hover:text-app-ink hover:decoration-app-primary focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            ← Back to dashboard
          </Link>
        </p>
      </div>
      <EpisodeStartFlow />
    </div>
  );
}
