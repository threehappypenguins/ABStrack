import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@abstrack/supabase/server';
import { cookies } from 'next/headers';

export default async function DashboardPage() {
  // Get current user via server component
  const cookieStore = await cookies();
  const supabase = createSupabaseServerClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();

  // This should not happen due to proxy, but as a safety check
  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
        
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600">Email</p>
            <p className="font-medium">{user.email}</p>
          </div>

          <div>
            <p className="text-sm text-gray-600">User ID</p>
            <p className="font-mono text-sm break-all">{user.id}</p>
          </div>

          <form
            action="/api/auth/logout"
            method="POST"
            className="mt-8"
          >
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
