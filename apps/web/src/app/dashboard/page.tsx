import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server-client';
import { healthCheckProfilesLimit1 } from '@abstrack/supabase';

interface HealthCheckResult {
  success: boolean;
  message: string;
  error?: string;
}

export default async function DashboardPage() {
  // Get current user via server component
  const supabase = await createServerClient();
  const showHealthCheck = process.env.NODE_ENV !== 'production';
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // This should not happen due to proxy, but as a safety check
  if (!user) {
    redirect('/login');
  }

  // Perform health check only in non-production to avoid leaking details.
  let healthCheck: HealthCheckResult | null = null;

  if (showHealthCheck) {
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
            'Health check passed: env vars, session, and RLS are functional',
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
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold mb-4">Dashboard</h1>

        {showHealthCheck && healthCheck && (
          <div
            className={`mb-6 p-4 rounded-md border ${
              healthCheck.success
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <div
              className={`font-semibold mb-2 ${
                healthCheck.success ? 'text-green-800' : 'text-red-800'
              }`}
            >
              {healthCheck.success
                ? '✓ Health Check Passed'
                : '✗ Health Check Failed'}
            </div>
            <p
              className={`text-sm ${
                healthCheck.success ? 'text-green-700' : 'text-red-700'
              }`}
            >
              {healthCheck.message}
            </p>
            {healthCheck.error && (
              <details className="mt-2 cursor-pointer">
                <summary className="text-xs font-medium underline">
                  Error Details
                </summary>
                <pre className="mt-2 text-xs overflow-auto bg-white p-2 rounded border">
                  {healthCheck.error}
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600">Email</p>
            <p className="font-medium">{user.email}</p>
          </div>

          <div>
            <p className="text-sm text-gray-600">User ID</p>
            <p className="font-mono text-sm break-all">{user.id}</p>
          </div>

          <form action="/api/auth/logout" method="POST" className="mt-8">
            <button
              type="submit"
              className="w-full bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 transition-colors"
            >
              Logout
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
