import { Suspense } from 'react';
import { ManageRecordsPage } from '@/components/manage/ManageRecordsPage';

/**
 * Consolidated management for episodes, standalone health markers, and standalone food diary rows.
 *
 * @returns Manage hub (client lists with tabs).
 */
export default function ManagePage() {
  return (
    <Suspense
      fallback={
        <p className="text-sm text-app-muted" role="status">
          Loading manage…
        </p>
      }
    >
      <ManageRecordsPage />
    </Suspense>
  );
}
