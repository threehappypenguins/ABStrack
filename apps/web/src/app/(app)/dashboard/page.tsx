import { redirect } from 'next/navigation';
import Link from 'next/link';
import { EpisodeStartHomeCta } from '@/components/episode-flow/EpisodeStartHomeCta';
import { createServerClient } from '@/lib/supabase/server-client';
import { healthCheckProfilesLimit1 } from '@abstrack/supabase';

interface HealthCheckResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Patient dashboard: dev-only Supabase health check and account summary. Auth and shell come from
 * the parent `(app)` layout.
 *
 * @returns Dashboard content.
 */
export default async function DashboardPage() {
  const supabase = await createServerClient();
  const showHealthCheck = process.env.NODE_ENV !== 'production';
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();
  const allowDevAuthErrorDebugView = showHealthCheck && !!getUserError;

  if (getUserError) {
    console.error(
      'Failed to fetch authenticated user for dashboard',
      getUserError,
    );
  }

  let healthCheck: HealthCheckResult | null = null;

  if (showHealthCheck && getUserError) {
    healthCheck = {
      success: false,
      message: 'Health check failed during auth user lookup',
      error: getUserError.message,
    };
  }

  if (!user && !allowDevAuthErrorDebugView) {
    redirect('/login');
  }

  if (showHealthCheck && user && !healthCheck) {
    try {
      const result = await healthCheckProfilesLimit1(supabase);

      if (result.error) {
        healthCheck = {
          success: false,
          message: 'Health check failed',
          error: result.error.message,
        };
      } else {
        healthCheck = {
          success: true,
          message:
            'Health check passed: authenticated user found and profiles query executed without API error (empty rows may still indicate no profile or restrictive RLS).',
        };
      }
    } catch (err) {
      healthCheck = {
        success: false,
        message: 'Health check error',
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-app-muted">
          Account overview and development health checks.
        </p>
      </div>

      <EpisodeStartHomeCta />

      <div className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8">
        {showHealthCheck && healthCheck && (
          <div
            className={`mb-6 rounded-lg border p-4 ${
              healthCheck.success
                ? 'border-green-200 bg-green-50 dark:border-green-800/60 dark:bg-green-950/35'
                : 'border-red-200 bg-red-50 dark:border-red-800/60 dark:bg-red-950/35'
            }`}
          >
            <div
              className={`mb-2 font-semibold ${
                healthCheck.success
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-red-800 dark:text-red-200'
              }`}
            >
              {healthCheck.success
                ? '✓ Health Check Passed'
                : '✗ Health Check Failed'}
            </div>
            <p
              className={`text-sm ${
                healthCheck.success
                  ? 'text-green-700 dark:text-green-300/95'
                  : 'text-red-700 dark:text-red-300/95'
              }`}
            >
              {healthCheck.message}
            </p>
            {healthCheck.error && (
              <details className="mt-2 cursor-pointer">
                <summary className="text-xs font-medium underline">
                  Error Details
                </summary>
                <pre className="mt-2 overflow-auto rounded border border-app-border bg-app-bg p-2 text-xs text-app-ink">
                  {healthCheck.error}
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <p className="text-sm text-app-muted">Food diary</p>
            <Link
              href="/food-diary/new"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-app-border bg-app-surface px-3 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            >
              Add a food diary entry
            </Link>
          </div>
          {user ? (
            <>
              <div>
                <p className="text-sm text-app-muted">Email</p>
                <p className="font-medium text-app-ink">{user.email}</p>
              </div>

              <div>
                <p className="text-sm text-app-muted">User ID</p>
                <p className="break-all font-mono text-sm text-app-ink">
                  {user.id}
                </p>
              </div>
            </>
          ) : (
            <div>
              <p className="text-sm text-app-muted">Authentication Status</p>
              <p className="font-medium text-red-700 dark:text-red-300">
                No authenticated user available (development debug view)
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
