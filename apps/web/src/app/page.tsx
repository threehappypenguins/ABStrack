'use client';

import { useAuth } from '../lib/auth-provider';
import Link from 'next/link';

export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (session) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
          <h1 className="text-2xl font-bold mb-4">Welcome to ABStrack</h1>
          <p className="text-gray-600 mb-6">
            You are logged in and ready to start tracking.
          </p>

          <div className="space-y-3">
            <Link
              href="/dashboard"
              className="block w-full text-center bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
            >
              Go to Dashboard
            </Link>
            <form action="/api/auth/logout" method="POST">
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

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold mb-4 text-center">ABStrack</h1>
        <p className="text-gray-600 mb-8 text-center">
          Health tracking application for Auto-Brewery Syndrome
        </p>

        <div className="space-y-4">
          <Link
            href="/login"
            className="block w-full text-center bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors font-medium"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="block w-full text-center bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition-colors font-medium"
          >
            Sign Up
          </Link>
        </div>

        <p className="mt-8 text-center text-sm text-gray-500">
          ABStrack is an open-source health tracking application
        </p>
      </div>
    </div>
  );
}
