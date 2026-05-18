import { InsightsClient } from './InsightsClient';

/**
 * Patient insights charts: server wrapper for the interactive chart builder.
 *
 * @returns Insights page with client-side data loading and filters.
 */
export default function InsightsPage() {
  return <InsightsClient />;
}
