import { FoodDiaryEntryForm } from '@/components/food-diary/FoodDiaryEntryForm';

/**
 * Standalone food diary entry page from the dashboard/home surface.
 *
 * @returns Food diary form without an episode link.
 */
export default function FoodDiaryNewPage() {
  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          New food diary entry
        </h1>
        <p className="mt-1 text-sm text-app-muted">
          Use this when you want to log food outside an active episode.
        </p>
      </div>
      <FoodDiaryEntryForm />
    </div>
  );
}
