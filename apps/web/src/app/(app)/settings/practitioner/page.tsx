import type { Metadata } from 'next';
import { PractitionerAccessPage } from '@/components/settings/PractitionerAccessPage';

export const metadata: Metadata = {
  title: 'Practitioner access | ABStrack',
  description:
    'Invite or revoke a healthcare practitioner who can read your ABStrack data from the practitioner web app; two-factor is required only if they use password sign-in.',
};

/**
 * Patient settings for practitioner sharing (PRD §8).
 *
 * @returns Practitioner settings page.
 */
export default function PractitionerSettingsPage() {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 lg:px-8"
    >
      <PractitionerAccessPage />
    </main>
  );
}
