import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SettingsPage } from '@/components/settings/SettingsPage';

export const metadata: Metadata = {
  title: 'Settings | ABStrack',
  description:
    'Account, security, and invite settings for your ABStrack patient account.',
};

/**
 * Settings hub: account profile, security, and patient invite management.
 *
 * @returns Settings page wrapped in Suspense for search-param tabs.
 */
export default function SettingsRoutePage() {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 lg:px-8"
    >
      <Suspense
        fallback={
          <p className="text-sm text-app-muted" role="status">
            Loading settings…
          </p>
        }
      >
        <SettingsPage />
      </Suspense>
    </main>
  );
}
