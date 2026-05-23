import { redirect } from 'next/navigation';

/**
 * Legacy caretaker settings URL; redirects to Settings → Invites.
 */
export default function CaretakerSettingsRedirectPage() {
  redirect('/settings?tab=invites');
}
