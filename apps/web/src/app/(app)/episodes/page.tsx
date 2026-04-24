import { redirect } from 'next/navigation';

/**
 * Episodes management moved under `/manage` with a dedicated Episodes segment.
 *
 * @returns Never (redirect).
 */
export default function EpisodesPage() {
  redirect('/manage?segment=episodes');
}
