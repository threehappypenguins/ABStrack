import type { Metadata } from 'next';
import { CaretakerAccessPage } from '@/components/settings/CaretakerAccessPage';

export const metadata: Metadata = {
  title: 'Caretaker access | ABStrack',
  description:
    'Link or revoke a caretaker who can log episodes on your behalf using their own account.',
};

/**
 * Patient settings surface for a single active caretaker grant (PRD §7).
 *
 * @returns Caretaker settings page.
 */
export default function CaretakerSettingsPage() {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 lg:px-8"
    >
      <CaretakerAccessPage />
    </main>
  );
}
