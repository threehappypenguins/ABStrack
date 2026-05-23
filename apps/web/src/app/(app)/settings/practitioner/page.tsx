import { redirect } from 'next/navigation';

/**
 * Legacy practitioner settings URL; redirects to Settings → Invites.
 */
export default function PractitionerSettingsRedirectPage() {
  redirect('/settings?tab=invites');
}
