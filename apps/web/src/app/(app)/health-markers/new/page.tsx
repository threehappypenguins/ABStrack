import Link from 'next/link';
import { StandaloneHealthMarkerFlow } from '@/components/health-markers/StandaloneHealthMarkerFlow';

/**
 * Standalone health-marker logging route (no episode).
 *
 * @returns Marker preset picker and prompt flow.
 */
export default function StandaloneHealthMarkersPage() {
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
      <StandaloneHealthMarkerFlow />
    </div>
  );
}
