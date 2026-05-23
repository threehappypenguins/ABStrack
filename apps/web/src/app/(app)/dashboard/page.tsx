import { EpisodeStartHomeCta } from '@/components/episode-flow/EpisodeStartHomeCta';
import { DashboardHomeCtaCard } from '@/components/dashboard/DashboardHomeCtaCard';
import { DashboardRecentEpisodes } from '@/components/dashboard/DashboardRecentEpisodes';

/**
 * Patient home dashboard: episode logging, standalone health markers and food diary entry,
 * and a short preview of recent ended episodes. Auth and shell come from the parent `(app)`
 * layout.
 *
 * @returns Dashboard content.
 */
export default function DashboardPage() {
  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Dashboard
        </h1>
      </div>

      <EpisodeStartHomeCta />

      <DashboardHomeCtaCard
        heading="Health markers"
        description="Log vitals and wellness markers outside an episode using your health marker presets."
        href="/health-markers/new"
        ctaLabel="Log health markers"
      />

      <DashboardHomeCtaCard
        heading="Food diary"
        description="Record meals and notes on their own, or link entries when you log during an episode."
        href="/food-diary/new"
        ctaLabel="Add a food diary entry"
      />

      <DashboardRecentEpisodes />
    </div>
  );
}
