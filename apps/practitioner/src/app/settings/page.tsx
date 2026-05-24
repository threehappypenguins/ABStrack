import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SettingsPage } from '@/components/settings/SettingsPage';

export const metadata: Metadata = {
  title: 'Settings | ABStrack Practitioner',
  description:
    'Account and security settings for healthcare practitioners on ABStrack.',
};

/**
 * Settings hub for the practitioner app: account details and security controls.
 *
 * @returns Settings page wrapped in Suspense for search-param tabs.
 */
export default function SettingsRoutePage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-app-muted" role="status">
          Loading settings…
        </p>
      }
    >
      <SettingsPage />
    </Suspense>
  );
}
