'use client';

import { useEffect } from 'react';
import { Week4PageError } from '@/components/week4/PageStates';

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
    <Week4PageError
      title="Could not load symptom presets"
      message={error.message}
      onRetry={reset}
    />
  );
}
