'use client';

import { useEffect } from 'react';
import { PageError } from '@/components/page-states/PageError';
import { getPublicErrorBoundaryMessage } from '@/lib/public-error-message';

/**
 * Segment error boundary for symptom presets routes.
 *
 * @param props - Next.js `error` boundary props.
 * @returns Recoverable error UI.
 */
export default function SymptomPresetsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageError
      title="Could not load symptom presets"
      message={getPublicErrorBoundaryMessage(error)}
      onRetry={reset}
    />
  );
}
