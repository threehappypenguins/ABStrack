import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { EpisodeRow } from '@abstrack/types';
import { formatEpisodeDurationSimple } from '@abstrack/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

function episodeSummaryLine(
  ep: Pick<EpisodeRow, 'episode_type' | 'episode_label'>,
) {
  const label = ep.episode_label?.trim();
  return label ? `${ep.episode_type} - ${label}` : ep.episode_type;
}

function formatInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso.trim() === '' ? '—' : iso;
  }
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export type HomeRecentEpisodesCardProps = {
  /** Recent ended episodes to preview. */
  episodes: EpisodeRow[];
  /** Shows a loading state while Home determines what to show. */
  loading: boolean;
  /** Error or status message when the preview cannot be fully loaded. */
  message: string | null;
  /** Visual + accessibility treatment for the optional message. */
  messageTone?: 'info' | 'error';
  /** Opens the full Manage episodes screen. */
  onViewAllEpisodes: () => void;
};

/**
 * Home-card preview of the patient's most recent ended episodes.
 *
 * @param props - Episode preview data and CTA.
 * @returns Card with loading, empty, error, and preview states.
 */
export function HomeRecentEpisodesCard({
  episodes,
  loading,
  message,
  messageTone = 'error',
  onViewAllEpisodes,
}: HomeRecentEpisodesCardProps) {
  const { colors } = useAppTheme();

  return (
    <View className={`gap-3 rounded-xl p-4 ${nw.card} ${nw.cardShadow}`}>
      <View className="gap-1">
        <Text className={`text-lg font-semibold ${nw.textInk}`}>
          Recent episodes
        </Text>
        <Text className={`text-sm leading-5 ${nw.textMuted}`}>
          Your latest ended episodes. Open Manage for the full history and
          filters.
        </Text>
      </View>

      {loading ? (
        <Text
          className={`text-sm ${nw.textMuted}`}
          accessibilityLiveRegion="polite"
        >
          Loading recent episodes...
        </Text>
      ) : null}

      {!loading && message ? (
        <Text
          className={`text-sm ${messageTone === 'info' ? nw.textMuted : nw.textError}`}
          accessibilityRole={messageTone === 'error' ? 'alert' : undefined}
        >
          {message}
        </Text>
      ) : null}

      {!loading && episodes.length === 0 && !message ? (
        <Text
          className={`rounded-xl border border-dashed p-4 text-sm ${nw.textMuted} ${nw.card}`}
        >
          No ended episodes yet. Start an episode when you are ready to log
          symptoms.
        </Text>
      ) : null}

      {!loading && episodes.length > 0 ? (
        <View className="gap-3" accessibilityRole="list">
          {episodes.map((episode) => (
            <View
              key={episode.id}
              className={`rounded-xl border px-4 py-3 ${nw.card}`}
            >
              <Text className={`text-base font-semibold ${nw.textInk}`}>
                {episodeSummaryLine(episode)}
              </Text>
              <Text className={`mt-2 text-sm ${nw.textMuted}`}>
                Ended {episode.ended_at ? formatInstant(episode.ended_at) : '—'}
              </Text>
              <Text className={`text-sm ${nw.textMuted}`}>
                Duration{' '}
                {formatEpisodeDurationSimple(
                  episode.started_at,
                  episode.ended_at,
                ) ?? '—'}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View all episodes"
        onPress={onViewAllEpisodes}
        className={`min-h-[48px] items-center justify-center rounded-xl border px-4 py-3 ${nw.card}`}
        style={{ borderColor: colors.border, backgroundColor: colors.surface }}
      >
        <Text className={`text-center text-sm font-semibold ${nw.textInk}`}>
          View all episodes
        </Text>
      </Pressable>
    </View>
  );
}
